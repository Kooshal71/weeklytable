import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { isDeliveryDateEligible, getWeekday } from "@/lib/cutoff";
import { isDeliveryTimeValid } from "@/lib/deliveryTime";
import { sendOrderConfirmationEmail } from "@/lib/mail";
import { UK_POSTCODE_RE } from "@/lib/address";
import type { OrderSource } from "@/generated/prisma/enums";

// Order validation + creation shared by every ordering channel: the website
// (POST /api/orders) and the WhatsApp bot (src/lib/whatsapp/bot.ts). Nothing
// a channel sends is trusted — every check here re-reads the database.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const PAYMENT_METHODS = ["stripe", "cash"] as const;
export type PaymentMethodInput = (typeof PAYMENT_METHODS)[number];
export const MAX_NOTES_LENGTH = 1000;
// Stripe's product_data.name accepts up to 5000 characters (verified
// directly against the Checkout Sessions API) — the dish list is the
// operationally critical part, so notes get truncated first if the
// combined string would somehow exceed it.
const MAX_STRIPE_PRODUCT_NAME_LENGTH = 5000;

export { EMAIL_RE };

export type OrderItemInput = { dishId: string; deliveryDate: string; deliveryTime: string };

export type OrderInput = {
  planId: string;
  items: OrderItemInput[];
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  postcode: string;
  paymentMethod: PaymentMethodInput;
  notes: string | null;
};

export type PlaceOrderResult =
  | { ok: true; orderId: string; checkoutUrl?: string }
  | { ok: false; error: string; status: 400 | 502 };

type PlanForQuote = { priceGbp: number; mealCount: number; allowExtraMeals: boolean };

/** Whether a plan accepts this many meals. */
export function planAcceptsMealCount(plan: PlanForQuote, mealCount: number): boolean {
  return plan.allowExtraMeals ? mealCount >= plan.mealCount : mealCount === plan.mealCount;
}

/**
 * What an order of `mealCount` meals on `plan` costs, in pence. Fixed plans
 * charge the plan's own price regardless of item count (validated as exact
 * elsewhere). Open-ended plans ("5+ meals") charge per meal at the plan's
 * own rate — never trust a client-supplied total, this is the sole source
 * of truth for what gets charged.
 */
export function quoteOrderGbp(plan: PlanForQuote, mealCount: number): number {
  const pricePerMealGbp = Math.round(plan.priceGbp / plan.mealCount);
  return plan.allowExtraMeals ? pricePerMealGbp * mealCount : plan.priceGbp;
}

/** The full per-meal price: the dearest per-meal rate among `plans` (the
 * single-meal plan, in practice). Bigger plans are discounts off this. */
export function fullPricePerMealGbp(plans: PlanForQuote[]): number {
  return Math.max(0, ...plans.map((p) => Math.round(p.priceGbp / p.mealCount)));
}

/** How much `mealCount` meals on `plan` save against the full per-meal
 * price, in pence (0 when there is no saving). */
export function planSavingGbp(plan: PlanForQuote, mealCount: number, plans: PlanForQuote[]): number {
  return Math.max(0, fullPricePerMealGbp(plans) * mealCount - quoteOrderGbp(plan, mealCount));
}

function badRequest(error: string): PlaceOrderResult {
  return { ok: false, error, status: 400 };
}

/**
 * Validates `input` against the live menu, plans and cutoff settings, then
 * either records a cash order or creates a Stripe Checkout Session (and the
 * order behind it). `origin` is the site origin used for Stripe's return
 * URLs.
 */
export async function placeOrder(
  input: OrderInput,
  { origin, source }: { origin: string; source: OrderSource },
): Promise<PlaceOrderResult> {
  const {
    planId,
    items,
    contactName,
    contactPhone,
    contactEmail,
    addressLine1,
    addressLine2,
    city,
    paymentMethod,
    notes,
  } = input;

  if (planId.trim() === "") {
    return badRequest("planId is required.");
  }
  if (items.length === 0) {
    return badRequest(
      "items must be a non-empty array of { dishId, deliveryDate, deliveryTime }.",
    );
  }
  if (!items.every((item) => DATE_RE.test(item.deliveryDate))) {
    return badRequest("Each item's deliveryDate must be in YYYY-MM-DD format.");
  }
  if (!items.every((item) => TIME_RE.test(item.deliveryTime))) {
    return badRequest("Each item's deliveryTime must be in HH:MM (24h) format.");
  }
  if (contactName.trim() === "") {
    return badRequest("contactName is required.");
  }
  if (contactPhone.trim() === "") {
    return badRequest("contactPhone is required.");
  }
  if (!EMAIL_RE.test(contactEmail)) {
    return badRequest("contactEmail must be a valid email address.");
  }
  if (addressLine1.trim() === "") {
    return badRequest("addressLine1 is required.");
  }
  if (city.trim() === "") {
    return badRequest("city is required.");
  }
  if (!UK_POSTCODE_RE.test(input.postcode.trim())) {
    return badRequest("postcode must be a valid UK postcode.");
  }
  const postcode = input.postcode.trim().toUpperCase();
  if (notes !== null && notes.length > MAX_NOTES_LENGTH) {
    return badRequest(`notes must be ${MAX_NOTES_LENGTH} characters or fewer.`);
  }

  // --- Authoritative server-side checks. Nothing above this line is trusted. ---

  const cutoffConfig = await prisma.cutoffConfig.findUniqueOrThrow({
    where: { id: "default" },
  });
  const ineligibleDates = Array.from(
    new Set(items.map((i) => i.deliveryDate)),
  ).filter((date) => !isDeliveryDateEligible(date, cutoffConfig));
  if (ineligibleDates.length > 0) {
    return badRequest(
      "One or more selected delivery dates are no longer available — please refresh and choose again.",
    );
  }

  const invalidTimes = Array.from(
    new Set(items.map((i) => i.deliveryTime)),
  ).filter((time) => !isDeliveryTimeValid(time, cutoffConfig));
  if (invalidTimes.length > 0) {
    return badRequest(
      "One or more requested delivery times are outside our delivery hours — please refresh and choose again.",
    );
  }

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) {
    return badRequest("That plan is no longer available.");
  }
  if (!planAcceptsMealCount(plan, items.length)) {
    return badRequest(
      `${plan.label} requires ${plan.allowExtraMeals ? "at least" : "exactly"} ${plan.mealCount} meal${plan.mealCount === 1 ? "" : "s"}.`,
    );
  }

  const totalPriceGbp = quoteOrderGbp(plan, items.length);

  const uniqueDishIds = Array.from(new Set(items.map((i) => i.dishId)));
  const activeDishes = await prisma.dish.findMany({
    where: { id: { in: uniqueDishIds }, isActive: true },
    select: { id: true, name: true, availableDays: true },
  });
  const dishById = new Map(activeDishes.map((d) => [d.id, d]));
  if (activeDishes.length !== uniqueDishIds.length) {
    return badRequest("One or more selected dishes are no longer available.");
  }

  // Not every dish is made every day — re-check each item's own date
  // independently of whatever the client filtered client-side.
  const mismatched = items.filter((item) => {
    const dish = dishById.get(item.dishId)!;
    return !dish.availableDays.includes(getWeekday(item.deliveryDate));
  });
  if (mismatched.length > 0) {
    const names = Array.from(
      new Set(mismatched.map((i) => dishById.get(i.dishId)!.name)),
    );
    return badRequest(
      `${names.join(", ")} ${names.length === 1 ? "is" : "are"} not available for delivery on the selected day — please refresh and choose again.`,
    );
  }

  // --- Everything validated. Branch on payment method. ---

  const orderData = {
    planId: plan.id,
    planLabelSnapshot: plan.label,
    planPriceGbpSnapshot: totalPriceGbp,
    contactName,
    contactPhone,
    contactEmail,
    addressLine1,
    addressLine2,
    city,
    postcode,
    notes,
    source,
    status: "pending_payment" as const,
    items: {
      create: items.map((item) => ({
        dishId: item.dishId,
        dishNameSnapshot: dishById.get(item.dishId)!.name,
        deliveryDate: new Date(`${item.deliveryDate}T00:00:00.000Z`),
        deliveryTime: item.deliveryTime,
      })),
    },
  };

  if (paymentMethod === "cash") {
    // No Stripe interaction at all — the order sits "awaiting payment"
    // until an admin manually marks it paid once cash is collected (see
    // markOrderPaidCash in admin/orders/actions.ts, strictly gated to
    // paymentMethod: "cash"). This is the only other way an Order can
    // ever reach "paid" besides the Stripe webhook.
    const order = await prisma.order.create({
      data: { ...orderData, paymentMethod: "cash" },
      include: { items: true },
    });

    await sendOrderConfirmationEmail(order);

    return { ok: true, orderId: order.id };
  }

  // --- paymentMethod === "stripe": create the Checkout Session first, so
  // we never write an Order row that doesn't correspond to a real session. ---

  const orderId = randomUUID();

  // The line item is priced per-plan, not per-dish (no à la carte pricing),
  // so the chosen dishes would otherwise never appear anywhere on the
  // Stripe receipt. Stripe's receipt template only ever renders the line
  // item's name (verified against a real receipt page) — product_data's
  // own `description` field is stored but never shown — so the dish list
  // (and now notes) has to go in the name itself.
  const itemsSummary = [...items]
    .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))
    .map(
      (item) =>
        `${dishById.get(item.dishId)!.name} (${item.deliveryDate} at ${item.deliveryTime})`,
    )
    .join(", ");

  const baseProductName = `${plan.label} — ${itemsSummary}`;
  let productName = notes ? `${baseProductName} | Notes: ${notes}` : baseProductName;
  if (productName.length > MAX_STRIPE_PRODUCT_NAME_LENGTH) {
    const prefix = `${baseProductName} | Notes: `;
    const budget = MAX_STRIPE_PRODUCT_NAME_LENGTH - prefix.length - 1; // reserve 1 for "…"
    productName =
      notes && budget > 10
        ? `${prefix}${notes.slice(0, budget)}…`
        : baseProductName.slice(0, MAX_STRIPE_PRODUCT_NAME_LENGTH);
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "gbp",
            unit_amount: totalPriceGbp,
            product_data: { name: productName },
          },
          quantity: 1,
        },
      ],
      metadata: {
        orderId,
        mealCount: String(items.length),
      },
      customer_email: contactEmail,
      success_url: `${origin}/order-confirmed?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/order?checkout=cancelled`,
    });
  } catch (err) {
    console.error("Stripe Checkout session creation failed:", err);
    return { ok: false, error: "Could not start checkout. Please try again.", status: 502 };
  }

  if (!session.url) {
    return { ok: false, error: "Could not start checkout. Please try again.", status: 502 };
  }

  await prisma.order.create({
    data: {
      ...orderData,
      id: orderId,
      paymentMethod: "stripe",
      stripeCheckoutSessionId: session.id,
    },
  });

  return { ok: true, orderId, checkoutUrl: session.url };
}
