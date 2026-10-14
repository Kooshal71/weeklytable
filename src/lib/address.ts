// Standard UK postcode format (not a real-postcode lookup — just shape
// validation, same spirit as the email/time regexes elsewhere).
export const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export type AddressParts = {
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  postcode: string;
};

// Single source of truth for how the four stored fields render as one
// line — every display context (confirmation page, admin pages, email)
// calls this instead of re-joining the parts itself.
export function formatDeliveryAddress({
  addressLine1,
  addressLine2,
  city,
  postcode,
}: AddressParts): string {
  return [addressLine1, addressLine2, city, postcode].filter(Boolean).join(", ");
}
