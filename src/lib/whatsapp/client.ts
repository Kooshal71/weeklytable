// Thin wrapper over the WhatsApp Cloud API (Meta Graph API) for sending
// messages. Like src/lib/mail.ts, a missing configuration logs once and
// no-ops, and a failed send is logged but never throws — a WhatsApp outage
// must never break order handling.
//
// WHATSAPP_DRY_RUN=true logs every outgoing payload instead of sending it,
// for local testing with scripts/whatsapp-simulate.ts.

// One place to bump when Meta retires this version (each lasts ~2 years).
export const GRAPH_API_VERSION = "v23.0";
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// WhatsApp's own limits on interactive messages.
export const MAX_BUTTONS = 3;
export const MAX_BUTTON_TITLE = 20;
export const MAX_LIST_ROWS = 10;
export const MAX_ROW_TITLE = 24;
export const MAX_ROW_DESCRIPTION = 72;

export type ListRow = { id: string; title: string; description?: string };
export type Button = { id: string; title: string };

export type OutgoingMessage =
  | { kind: "text"; body: string }
  | { kind: "buttons"; body: string; buttons: Button[] }
  | { kind: "list"; body: string; buttonLabel: string; rows: ListRow[] }
  | { kind: "catalog"; body: string; thumbnailRetailerId?: string }
  | { kind: "cta_url"; body: string; label: string; url: string };

let warnedMissingConfig = false;

function credentials() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) return null;
  return { accessToken, phoneNumberId };
}

export function isWhatsAppConfigured(): boolean {
  return credentials() !== null;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function toPayload(to: string, message: OutgoingMessage): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  switch (message.kind) {
    case "text":
      return { ...base, type: "text", text: { body: message.body, preview_url: false } };
    case "buttons":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: message.body },
          action: {
            buttons: message.buttons.slice(0, MAX_BUTTONS).map((b) => ({
              type: "reply",
              reply: { id: b.id, title: truncate(b.title, MAX_BUTTON_TITLE) },
            })),
          },
        },
      };
    case "list":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: message.body },
          action: {
            button: truncate(message.buttonLabel, MAX_BUTTON_TITLE),
            sections: [
              {
                title: truncate(message.buttonLabel, MAX_ROW_TITLE),
                rows: message.rows.slice(0, MAX_LIST_ROWS).map((r) => ({
                  id: r.id,
                  title: truncate(r.title, MAX_ROW_TITLE),
                  ...(r.description
                    ? { description: truncate(r.description, MAX_ROW_DESCRIPTION) }
                    : {}),
                })),
              },
            ],
          },
        },
      };
    case "catalog":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "catalog_message",
          body: { text: message.body },
          action: {
            name: "catalog_message",
            ...(message.thumbnailRetailerId
              ? { parameters: { thumbnail_product_retailer_id: message.thumbnailRetailerId } }
              : {}),
          },
        },
      };
    case "cta_url":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "cta_url",
          body: { text: message.body },
          action: {
            name: "cta_url",
            parameters: { display_text: truncate(message.label, MAX_BUTTON_TITLE), url: message.url },
          },
        },
      };
  }
}

async function postToGraph(payload: Record<string, unknown>): Promise<boolean> {
  if (process.env.WHATSAPP_DRY_RUN === "true") {
    console.log("[whatsapp dry run]", JSON.stringify(payload));
    return true;
  }

  const creds = credentials();
  if (!creds) {
    if (!warnedMissingConfig) {
      console.warn(
        "WhatsApp: WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set, messages are skipped.",
      );
      warnedMissingConfig = true;
    }
    return false;
  }

  try {
    const res = await fetch(`${GRAPH_API_BASE}/${creds.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.error(`WhatsApp: send failed: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("WhatsApp: send failed:", err);
    return false;
  }
}

/** Sends one message to a WhatsApp number (wa_id, digits only). */
export async function sendWhatsAppMessage(to: string, message: OutgoingMessage): Promise<boolean> {
  return postToGraph(toPayload(to, message));
}

/** Shows the customer the blue ticks for a message they sent. */
export async function markWhatsAppMessageRead(messageId: string): Promise<void> {
  await postToGraph({ messaging_product: "whatsapp", status: "read", message_id: messageId });
}
