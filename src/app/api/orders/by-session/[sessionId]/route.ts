import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatDeliveryAddress } from "@/lib/address";

// Safe to expose without auth: `sessionId` is either a real Stripe
// Checkout session id (card orders) or an Order's own id (cash orders
// only, since they never create a Stripe session) — both are
// server-generated, unguessable tokens only the customer who just
// ordered would have. The id-based branch is scoped to paymentMethod:
// "cash" so it can never become a way to look up a Stripe order by its
// own id.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  const order = await prisma.order.findFirst({
    where: {
      OR: [
        { stripeCheckoutSessionId: sessionId },
        { id: sessionId, paymentMethod: "cash" },
      ],
    },
    select: {
      id: true,
      status: true,
      paymentMethod: true,
      planLabelSnapshot: true,
      planPriceGbpSnapshot: true,
      contactName: true,
      contactEmail: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      postcode: true,
      notes: true,
      items: {
        select: { dishNameSnapshot: true, deliveryDate: true, deliveryTime: true },
        orderBy: { deliveryDate: "asc" },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  return NextResponse.json({
    orderId: order.id,
    status: order.status,
    paymentMethod: order.paymentMethod,
    planLabel: order.planLabelSnapshot,
    priceGbp: order.planPriceGbpSnapshot,
    contactName: order.contactName,
    contactEmail: order.contactEmail,
    deliveryAddress: formatDeliveryAddress(order),
    notes: order.notes,
    meals: order.items.map((i) => ({
      dishName: i.dishNameSnapshot,
      deliveryDate: i.deliveryDate.toISOString().slice(0, 10),
      deliveryTime: i.deliveryTime,
    })),
  });
}
