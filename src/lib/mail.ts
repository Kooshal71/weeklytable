import { formatGuaranteeWindow, formatTime12h } from "@/lib/deliveryTime";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_TEL } from "@/lib/contact";
import { formatDeliveryAddress } from "@/lib/address";

type OrderForEmail = {
  paymentMethod: "stripe" | "cash";
  planLabelSnapshot: string;
  planPriceGbpSnapshot: number;
  contactName: string;
  contactEmail: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  postcode: string;
  notes: string | null;
  items: { dishNameSnapshot: string; deliveryDate: Date; deliveryTime: string | null }[];
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function graphCredentials() {
  const tenantId = process.env.MS365_TENANT_ID;
  const clientId = process.env.MS365_CLIENT_ID;
  const clientSecret = process.env.MS365_CLIENT_SECRET;
  const senderEmail = process.env.MS365_SENDER_EMAIL;
  if (!tenantId || !clientId || !clientSecret || !senderEmail) return null;
  return { tenantId, clientId, clientSecret, senderEmail };
}

async function getGraphAccessToken(
  creds: NonNullable<ReturnType<typeof graphCredentials>>,
): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Graph token request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh a minute early so we never hand out a token that expires
  // mid-request.
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmailHtml(order: OrderForEmail): string {
  const mealsHtml = [...order.items]
    .sort((a, b) => a.deliveryDate.getTime() - b.deliveryDate.getTime())
    .map((item) => {
      const dateStr = item.deliveryDate.toISOString().slice(0, 10);
      const timeHtml = item.deliveryTime
        ? ` <span style="color:#2B2421B3;font-size:13px;">(requested ${formatTime12h(item.deliveryTime)}, guaranteed ${formatGuaranteeWindow(item.deliveryTime)})</span>`
        : "";
      return `<li style="margin-bottom:6px;"><strong style="color:#C85A32;">${escapeHtml(dateStr)}</strong> — ${escapeHtml(item.dishNameSnapshot)}${timeHtml}</li>`;
    })
    .join("");

  const paymentNote =
    order.paymentMethod === "cash"
      ? "Please have the exact amount ready — payment is collected on delivery."
      : "Your payment has been received. A separate receipt was also sent by our payment processor.";

  const notesHtml = order.notes
    ? `<p style="margin:16px 0 0;"><strong>Notes:</strong> ${escapeHtml(order.notes)}</p>`
    : "";

  return `
<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;background:#FBF7EE;padding:32px;color:#2B2421;">
  <p style="color:#C85A32;font-weight:600;margin:0 0 4px;">Weekly Table</p>
  <h1 style="font-size:22px;margin:0 0 16px;">Thanks, ${escapeHtml(order.contactName.split(" ")[0])} — your order is confirmed</h1>
  <p style="margin:0 0 16px;"><strong>${escapeHtml(order.planLabelSnapshot)}</strong> (£${(order.planPriceGbpSnapshot / 100).toFixed(2)})</p>
  <ul style="list-style:none;padding:0;margin:0 0 16px;">${mealsHtml}</ul>
  <p style="margin:0 0 16px;"><strong>Delivering to:</strong> ${escapeHtml(formatDeliveryAddress(order))}</p>
  ${notesHtml}
  <p style="margin:16px 0;color:#2B2421B3;">${paymentNote}</p>
  <p style="margin:24px 0 0;font-size:13px;color:#2B2421B3;">
    Need help? Call us on
    <a href="${SUPPORT_PHONE_TEL}" style="color:#C85A32;font-weight:600;">${SUPPORT_PHONE_DISPLAY}</a>.
  </p>
</div>`.trim();
}

// Never throws — a failed confirmation email must not fail order creation
// or the Stripe webhook response. No-ops entirely (after logging once)
// until all four MS365_* env vars are set, so this is safe to deploy
// before credentials exist in any environment.
export async function sendOrderConfirmationEmail(order: OrderForEmail): Promise<void> {
  const creds = graphCredentials();
  if (!creds) {
    console.warn("sendOrderConfirmationEmail: MS365 env vars not configured, skipping.");
    return;
  }

  try {
    const token = await getGraphAccessToken(creds);
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(creds.senderEmail)}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: "Your Weekly Table order is confirmed",
            body: { contentType: "HTML", content: buildEmailHtml(order) },
            toRecipients: [{ emailAddress: { address: order.contactEmail } }],
          },
          saveToSentItems: true,
        }),
      },
    );

    if (!res.ok) {
      console.error("sendOrderConfirmationEmail: Graph sendMail failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("sendOrderConfirmationEmail: unexpected error:", err);
  }
}
