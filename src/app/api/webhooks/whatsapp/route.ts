import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidWhatsAppSignature } from "@/lib/whatsapp/signature";
import { markWhatsAppMessageRead } from "@/lib/whatsapp/client";
import { handleWhatsAppMessage, pauseBotForChat, type InboundMessage } from "@/lib/whatsapp/bot";

const PROCESSED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Meta's one-off check when the webhook URL is saved in the app dashboard.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (
    verifyToken &&
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === verifyToken
  ) {
    return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed." }, { status: 403 });
}

type WebhookMessage = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string };
    list_reply?: { id?: string };
  };
  button?: { payload?: string; text?: string };
  order?: { product_items?: { product_retailer_id?: string; quantity?: number | string }[] };
};

type WebhookChangeValue = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: WebhookMessage[];
  message_echoes?: { to?: string }[];
};

type WebhookBody = {
  object?: string;
  entry?: { changes?: { field?: string; value?: WebhookChangeValue }[] }[];
};

function toInbound(message: WebhookMessage, profileName: string | undefined): InboundMessage | null {
  if (!message.id || !message.from) return null;
  const base = { id: message.id, from: message.from, profileName };
  switch (message.type) {
    case "text":
      return { ...base, kind: "text", text: message.text?.body ?? "" };
    case "interactive": {
      const replyId = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
      return replyId ? { ...base, kind: "reply", replyId } : { ...base, kind: "other" };
    }
    case "button":
      // Quick-reply buttons on template messages carry text, not our ids.
      return { ...base, kind: "text", text: message.button?.text ?? message.button?.payload ?? "" };
    case "order":
      return {
        ...base,
        kind: "order",
        items: (message.order?.product_items ?? [])
          .filter((i) => typeof i.product_retailer_id === "string")
          .map((i) => ({ retailerId: i.product_retailer_id!, quantity: Number(i.quantity) || 0 })),
      };
    default:
      return { ...base, kind: "other" };
  }
}

/** Records the message id; false if it was already handled (Meta retry). */
async function claimMessage(id: string): Promise<boolean> {
  try {
    await prisma.whatsAppProcessedMessage.create({ data: { id } });
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return false;
    throw err;
  }
}

export async function POST(req: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error("WhatsApp webhook: WHATSAPP_APP_SECRET is not set.");
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }

  const rawBody = await req.text();
  if (!isValidWhatsAppSignature(rawBody, req.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (body.object !== "whatsapp_business_account") {
    return NextResponse.json({ received: true });
  }

  const ourNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const origin = req.nextUrl.origin;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      if (ourNumberId && value.metadata?.phone_number_id && value.metadata.phone_number_id !== ourNumberId) {
        continue;
      }

      // Coexistence: the owner replied from the WhatsApp Business app.
      if (change.field === "smb_message_echoes") {
        for (const echo of value.message_echoes ?? []) {
          if (echo.to) await pauseBotForChat(echo.to);
        }
        continue;
      }
      if (change.field !== "messages") continue;

      // Delivery/read status updates arrive here too, with no messages.
      for (const message of value.messages ?? []) {
        const contact = value.contacts?.find((c) => c.wa_id === message.from) ?? value.contacts?.[0];
        const inbound = toInbound(message, contact?.profile?.name);
        if (!inbound || !(await claimMessage(inbound.id))) continue;

        try {
          await markWhatsAppMessageRead(inbound.id);
          await handleWhatsAppMessage(inbound, origin);
        } catch (err) {
          console.error("WhatsApp webhook: failed to handle message", inbound.id, err);
          // Let Meta's retry have another go.
          await prisma.whatsAppProcessedMessage.deleteMany({ where: { id: inbound.id } });
          return NextResponse.json({ error: "Processing failed." }, { status: 500 });
        }
      }
    }
  }

  // Cheap housekeeping: occasionally drop old dedupe ids.
  if (Math.random() < 0.02) {
    await prisma.whatsAppProcessedMessage
      .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - PROCESSED_RETENTION_MS) } } })
      .catch((err: unknown) => console.error("WhatsApp webhook: prune failed:", err));
  }

  return NextResponse.json({ received: true });
}
