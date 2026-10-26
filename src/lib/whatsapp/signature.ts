import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verifies Meta's X-Hub-Signature-256 header ("sha256=<hex>"), an
 * HMAC-SHA256 of the raw request body keyed with the app secret. The raw
 * text must be used exactly as received — re-serialised JSON won't match.
 */
export function isValidWhatsAppSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
