import { after } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { GRAPH_API_BASE } from "@/lib/whatsapp/client";

// Pushes the dish menu into the Meta commerce catalogue linked to the
// WhatsApp Business account, so customers can browse it (and build a cart)
// inside WhatsApp. retailer_id is the dish id, which is how the bot maps a
// WhatsApp cart back to dishes.
//
// Every dish is upserted (never deleted), so switching one off in the admin
// just hides it, and switching it back on restores it. Dishes still on the
// SVG placeholder are left out: Meta only accepts JPEG/PNG product photos.

const DIETARY_LABEL: Record<string, string> = {
  vegetarian: "Vegetarian",
  gluten_free: "Gluten-free",
  high_protein: "High protein",
};

export function isCatalogConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_CATALOG_ID);
}

/** The site origin of the current request, for absolute catalogue links.
 * (The app deliberately has no site-URL setting.) */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** For admin dish edits: re-sync after the response is sent, so a slow or
 * failing Meta API never holds up (or breaks) the save. */
export async function syncWhatsAppCatalogAfterResponse(): Promise<void> {
  if (!isCatalogConfigured()) return;
  const origin = await requestOrigin();
  after(() => syncWhatsAppCatalog(origin));
}

function formatCatalogPrice(pence: number): string {
  return `${(pence / 100).toFixed(2)} GBP`;
}

export type CatalogSyncResult = { ok: boolean; message: string };

/** Upserts every dish into the catalogue. `origin` makes image and product
 * links absolute (e.g. "https://weeklytable.co.uk"). Records the outcome
 * for Admin > Settings and never throws. */
export async function syncWhatsAppCatalog(origin: string): Promise<CatalogSyncResult> {
  const result = await runSync(origin).catch((err: unknown): CatalogSyncResult => {
    console.error("syncWhatsAppCatalog failed:", err);
    return { ok: false, message: `Could not reach Meta: ${err instanceof Error ? err.message : String(err)}` };
  });

  await prisma.whatsAppCatalogSync
    .upsert({
      where: { id: "default" },
      update: result,
      create: { id: "default", ...result },
    })
    .catch((err: unknown) => console.error("syncWhatsAppCatalog: could not record result:", err));

  return result;
}

async function runSync(origin: string): Promise<CatalogSyncResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const catalogId = process.env.WHATSAPP_CATALOG_ID;
  if (!accessToken || !catalogId) {
    return { ok: false, message: "WHATSAPP_ACCESS_TOKEN or WHATSAPP_CATALOG_ID is not set." };
  }

  const [dishes, plans] = await Promise.all([
    prisma.dish.findMany({ orderBy: { name: "asc" } }),
    prisma.plan.findMany({ where: { isActive: true } }),
  ]);

  // Meta requires a price per product, but meals are priced by plan. Show
  // the cheapest per-meal rate; the bot quotes the real total before payment.
  const perMealRates = plans.map((p) => Math.round(p.priceGbp / p.mealCount));
  if (perMealRates.length === 0) {
    return { ok: false, message: "No active plans, so there is no price to show." };
  }
  const fromPence = Math.min(...perMealRates);

  const withPhoto = dishes.filter((d) => !d.imageUrl.endsWith(".svg"));
  const skipped = dishes.length - withPhoto.length;

  const requests = withPhoto.map((dish) => {
    const tag = dish.dietaryTag ? `${DIETARY_LABEL[dish.dietaryTag] ?? dish.dietaryTag}. ` : "";
    return {
      method: "UPDATE",
      data: {
        id: dish.id,
        title: dish.name,
        description: `${tag}${dish.description} Priced by your weekly plan, from £${(fromPence / 100).toFixed(2)} a meal.`,
        availability: dish.isActive ? "in stock" : "out of stock",
        visibility: dish.isActive ? "published" : "hidden",
        condition: "new",
        price: formatCatalogPrice(fromPence),
        link: `${origin}/menu`,
        image_link: `${origin}${dish.imageUrl}`,
        brand: "Weekly Table",
      },
    };
  });

  if (requests.length === 0) {
    return { ok: false, message: "No dishes with photos to sync." };
  }

  const res = await fetch(`${GRAPH_API_BASE}/${catalogId}/items_batch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ item_type: "PRODUCT_ITEM", allow_upsert: true, requests }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    return { ok: false, message: `Meta rejected the sync: ${res.status} ${await res.text()}` };
  }

  const active = withPhoto.filter((d) => d.isActive).length;
  return {
    ok: true,
    message:
      `Sent ${withPhoto.length} dishes (${active} on the menu)` +
      (skipped > 0 ? `; ${skipped} left out because they have no photo yet` : "") +
      ". Meta can take a few minutes to process them.",
  };
}
