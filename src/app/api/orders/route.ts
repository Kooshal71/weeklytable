import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { isDeliveryDateEligible, getWeekday } from "@/lib/cutoff";
import { isDeliveryTimeValid } from "@/lib/deliveryTime";
import { sendOrderConfirmationEmail } from "@/lib/mail";
import { UK_POSTCODE_RE } from "@/lib/address";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PAYMENT_METHODS = ["stripe", "cash"] as const;
type PaymentMethodInput = (typeof PAYMENT_METHODS)[number];
const MAX_NOTES_LENGTH = 1000;
// Stripe's product_data.name accepts up to 5000 characters (verified
// directly against the Checkout Sessions API) — the dish list is the
// operationally critical part, so notes get truncated first if the
// combined string would somehow exceed it.
const MAX_STRIPE_PRODUCT_NAME_LENGTH = 5000;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

type OrderItemInput = { dishId: string; deliveryDate: string; deliveryTime: string };

function parseItems(value: unknown): OrderItemInput[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items: OrderItemInput[] = [];
  for (const raw of value) {
    if (
      typeof raw !== "object" ||
      raw === null ||
      typeof (raw as Record<string, unknown>).dishId !== "string" ||
      typeof (raw as Record<string, unknown>).deliveryDate !== "string" ||
      typeof (raw as Record<string, unknown>).deliveryTime !== "string"
    ) {
      return null;
    }
    items.push({
      dishId: (raw as Record<string, unknown>).dishId as string,
      deliveryDate: (raw as Record<string, unknown>).deliveryDate as string,
      deliveryTime: (raw as Record<string, unknown>).deliveryTime as string,
    });
  }
  return items;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  if (typeof body !== "object" || body === null) {
    return badRequest("Invalid request body.");
  }

  const {
    planId,
    items: rawItems,
    contactName,
    contactPhone,
    contactEmail,
    addressLine1,
    addressLine2: rawAddressLine2,
    city,
    postcode: rawPostcode,
    paymentMethod: rawPaymentMethod,
    notes: rawNotes,
  } = body as Record<string, unknown>;

  if (typeof planId !== "string" || planId.trim() === "") {
    return badRequest("planId is required.");
  }
  const items = parseItems(rawItems);
  if (!items) {
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
  if (typeof contactName !== "string" || contactName.trim() === "") {
    return badRequest("contactName is required.");
  }
  if (typeof contactPhone !== "string" || contactPhone.trim() === "") {
    return badRequest("contactPhone is required.");
  }
  if (typeof contactEmail !== "string" || !EMAIL_RE.test(contactEmail)) {
    return badRequest("contactEmail must be a valid email address.");
  }
  if (typeof addressLine1 !== "string" || addressLine1.trim() === "") {
    return badRequest("addressLine1 is required.");
  }
  let addressLine2: string | null = null;
  if (rawAddressLine2 !== undefined && rawAddressLine2 !== null) {
    if (typeof rawAddressLine2 !== "string") {
      return badRequest("addressLine2 must be a string.");
    }
    const trimmed = rawAddressLine2.trim();
    addressLine2 = trimmed === "" ? null : trimmed;
  }
  if (typeof city !== "string" || city.trim() === "") {
    return badRequest("city is required.");
  }
  if (typeof rawPostcode !== "string" || !UK_POSTCODE_RE.test(rawPostcode.trim())) {
    return badRequest("postcode must be a valid UK postcode.");
  }
  const postcode = rawPostcode.trim().toUpperCase();
  if (
    typeof rawPaymentMethod !== "string" ||
    !PAYMENT_METHODS.includes(rawPaymentMethod as PaymentMethodInput)
  ) {
    return badRequest('paymentMethod must be "stripe" or "cash".');
  }
  const paymentMethod = rawPaymentMethod as PaymentMethodInput;

  let notes: string | null = null;
  if (rawNotes !== undefined && rawNotes !== null) {
    if (typeof rawNotes !== "string") {
      return badRequest("notes must be a string.");
    }
    const trimmed = rawNotes.trim();
    if (trimmed.length > MAX_NOTES_LENGTH) {
      return badRequest(`notes must be ${MAX_NOTES_LENGTH} characters or fewer.`);
    }
    notes = trimmed === "" ? null : trimmed;
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
  if (plan.allowExtraMeals) {
    if (items.length < plan.mealCount) {
      return badRequest(
        `${plan.label} requires at least ${plan.mealCount} meal${plan.mealCount === 1 ? "" : "s"}.`,
      );
    }
  } else if (items.length !== plan.mealCount) {
    return badRequest(
      `${plan.label} requires exactly ${plan.mealCount} meal${plan.mealCount === 1 ? "" : "s"}.`,
    );
  }

  // Fixed plans charge the plan's own price regardless of item count
  // (already validated as exact above). Open-ended plans ("5+ meals")
  // charge per meal at the plan's own rate — never trust a client-supplied
  // total, this is the sole source of truth for what gets charged.
  const pricePerMealGbp = Math.round(plan.priceGbp / plan.mealCount);
  const totalPriceGbp = plan.allowExtraMeals
    ? pricePerMealGbp * items.length
    : plan.priceGbp;

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

  if (paymentMethod === "cash") {
    // No Stripe interaction at all — the order sits "awaiting payment"
    // until an admin manually marks it paid once cash is collected (see
    // markOrderPaidCash in admin/orders/actions.ts, strictly gated to
    // paymentMethod: "cash"). This is the only other way an Order can
    // ever reach "paid" besides the Stripe webhook.
    const order = await prisma.order.create({
      data: {
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
        paymentMethod: "cash",
        status: "pending_payment",
        items: {
          create: items.map((item) => ({
            dishId: item.dishId,
            dishNameSnapshot: dishById.get(item.dishId)!.name,
            deliveryDate: new Date(`${item.deliveryDate}T00:00:00.000Z`),
            deliveryTime: item.deliveryTime,
          })),
        },
      },
      include: { items: true },
    });

    await sendOrderConfirmationEmail(order);

    return NextResponse.json({ orderId: order.id });
  }

  // --- paymentMethod === "stripe": create the Checkout Session first, so
  // we never write an Order row that doesn't correspond to a real session. ---

  const orderId = randomUUID();
  const origin = req.nextUrl.origin;

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
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 502 },
    );
  }

  if (!session.url) {
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 502 },
    );
  }

  await prisma.order.create({
    data: {
      id: orderId,
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
      paymentMethod: "stripe",
      status: "pending_payment",
      stripeCheckoutSessionId: session.id,
      items: {
        create: items.map((item) => ({
          dishId: item.dishId,
          dishNameSnapshot: dishById.get(item.dishId)!.name,
          deliveryDate: new Date(`${item.deliveryDate}T00:00:00.000Z`),
          deliveryTime: item.deliveryTime,
        })),
      },
    },
  });

  return NextResponse.json({ checkoutUrl: session.url });
}
