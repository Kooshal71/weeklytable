// Sends one fake, correctly signed WhatsApp webhook event to a running dev
// server, so the ordering bot can be tested without Meta. Run the server
// with WHATSAPP_DRY_RUN=true to see the bot's replies in its console
// instead of sending them.
//
//   npx tsx scripts/whatsapp-simulate.ts text "menu"
//   npx tsx scripts/whatsapp-simulate.ts reply "date:2026-10-28"
//   npx tsx scripts/whatsapp-simulate.ts order "<dishId>:2,<dishId>:1"
//   npx tsx scripts/whatsapp-simulate.ts echo        (owner replied from the app)
//
// Env: WHATSAPP_APP_SECRET (from .env), WA_FROM (default 447700900123),
// WA_NAME (default "Test Customer"), BASE_URL (default http://localhost:3000).

import "dotenv/config";
import { createHmac, randomUUID } from "crypto";

const [kind, arg = ""] = process.argv.slice(2);
const from = process.env.WA_FROM ?? "447700900123";
const name = process.env.WA_NAME ?? "Test Customer";
const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const secret = process.env.WHATSAPP_APP_SECRET;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "000";

if (!secret || !["text", "reply", "order", "echo"].includes(kind)) {
  console.error("Usage: whatsapp-simulate.ts text|reply|order|echo [value] (needs WHATSAPP_APP_SECRET)");
  process.exit(1);
}

const id = `wamid.sim-${randomUUID()}`;
const timestamp = String(Math.floor(Date.now() / 1000));

function message() {
  switch (kind) {
    case "text":
      return { id, from, timestamp, type: "text", text: { body: arg } };
    case "reply":
      return {
        id,
        from,
        timestamp,
        type: "interactive",
        interactive: { type: "list_reply", list_reply: { id: arg, title: arg } },
      };
    default:
      return {
        id,
        from,
        timestamp,
        type: "order",
        order: {
          catalog_id: "sim",
          product_items: arg.split(",").map((pair) => {
            const [retailerId, qty = "1"] = pair.split(":");
            return { product_retailer_id: retailerId, quantity: Number(qty), item_price: 8, currency: "GBP" };
          }),
        },
      };
  }
}

const value =
  kind === "echo"
    ? {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: phoneNumberId },
        message_echoes: [{ from: "447803170599", to: from, id, timestamp, type: "text", text: { body: "Hi!" } }],
      }
    : {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: phoneNumberId },
        contacts: [{ wa_id: from, profile: { name } }],
        messages: [message()],
      };

const body = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ id: "sim", changes: [{ field: kind === "echo" ? "smb_message_echoes" : "messages", value }] }],
});
const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

fetch(`${baseUrl}/api/webhooks/whatsapp`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
  body,
}).then(async (res) => console.log(res.status, await res.text()));
