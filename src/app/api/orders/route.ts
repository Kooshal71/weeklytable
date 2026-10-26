import { NextRequest, NextResponse } from "next/server";
import {
  PAYMENT_METHODS,
  placeOrder,
  type OrderItemInput,
  type PaymentMethodInput,
} from "@/lib/orders";

// Parses the website's order request into shape; every business rule
// (cutoff, plan size, pricing, dish availability) lives in placeOrder.

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

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
    postcode,
    paymentMethod,
    notes: rawNotes,
  } = body as Record<string, unknown>;

  if (typeof planId !== "string") {
    return badRequest("planId is required.");
  }
  const items = parseItems(rawItems);
  if (!items) {
    return badRequest(
      "items must be a non-empty array of { dishId, deliveryDate, deliveryTime }.",
    );
  }
  if (typeof contactName !== "string") {
    return badRequest("contactName is required.");
  }
  if (typeof contactPhone !== "string") {
    return badRequest("contactPhone is required.");
  }
  if (typeof contactEmail !== "string") {
    return badRequest("contactEmail must be a valid email address.");
  }
  if (typeof addressLine1 !== "string") {
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
  if (typeof city !== "string") {
    return badRequest("city is required.");
  }
  if (typeof postcode !== "string") {
    return badRequest("postcode must be a valid UK postcode.");
  }
  if (
    typeof paymentMethod !== "string" ||
    !PAYMENT_METHODS.includes(paymentMethod as PaymentMethodInput)
  ) {
    return badRequest('paymentMethod must be "stripe" or "cash".');
  }

  let notes: string | null = null;
  if (rawNotes !== undefined && rawNotes !== null) {
    if (typeof rawNotes !== "string") {
      return badRequest("notes must be a string.");
    }
    const trimmed = rawNotes.trim();
    notes = trimmed === "" ? null : trimmed;
  }

  const result = await placeOrder(
    {
      planId,
      items,
      contactName,
      contactPhone,
      contactEmail,
      addressLine1,
      addressLine2,
      city,
      postcode,
      paymentMethod: paymentMethod as PaymentMethodInput,
      notes,
    },
    { origin: req.nextUrl.origin, source: "web" },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(
    result.checkoutUrl ? { checkoutUrl: result.checkoutUrl } : { orderId: result.orderId },
  );
}
