import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { sendOrderConfirmationEmail } from "@/lib/mail";
import { notifyWhatsAppOrderPaid } from "@/lib/whatsapp/bot";

// The only place an Order's status ever becomes "paid". Never trust the
// success_url redirect for this — a signed, Stripe-verified webhook event
// is the sole source of truth for payment state.
export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.orderId;

    if (!orderId) {
      console.error("checkout.session.completed with no orderId in metadata", {
        sessionId: session.id,
      });
      return NextResponse.json({ received: true });
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      // Permanent condition (the order was never written, or the id is
      // wrong) — acknowledge so Stripe stops retrying, but log loudly.
      console.error("Webhook for unknown orderId:", orderId);
      return NextResponse.json({ received: true });
    }

    const paidOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "paid",
        stripePaymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null),
      },
      include: { items: true },
    });

    await sendOrderConfirmationEmail(paidOrder);
    if (paidOrder.source === "whatsapp") {
      await notifyWhatsAppOrderPaid(paidOrder);
    }
  }

  return NextResponse.json({ received: true });
}
