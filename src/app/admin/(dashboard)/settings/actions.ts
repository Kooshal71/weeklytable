"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/dal";
import { requestOrigin, syncWhatsAppCatalog } from "@/lib/whatsapp/catalog";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function updateCutoffConfig(formData: FormData) {
  await requireRole(["owner"]);
  const leadDays = Number(formData.get("leadDays"));
  const cutoffTime = String(formData.get("cutoffTime") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  const deliveryWindowStart = String(formData.get("deliveryWindowStart") ?? "").trim();
  const deliveryWindowEnd = String(formData.get("deliveryWindowEnd") ?? "").trim();

  if (!Number.isFinite(leadDays) || leadDays < 1) {
    throw new Error("Lead days must be a positive number.");
  }
  if (!TIME_RE.test(cutoffTime)) {
    throw new Error("Cutoff time must be in HH:MM (24h) format.");
  }
  if (!timezone) {
    throw new Error("Timezone is required.");
  }
  if (!TIME_RE.test(deliveryWindowStart) || !TIME_RE.test(deliveryWindowEnd)) {
    throw new Error("Delivery window times must be in HH:MM (24h) format.");
  }
  if (deliveryWindowStart >= deliveryWindowEnd) {
    throw new Error("Delivery window start must be before its end.");
  }

  await prisma.cutoffConfig.upsert({
    where: { id: "default" },
    update: { leadDays, cutoffTime, timezone, deliveryWindowStart, deliveryWindowEnd },
    create: {
      id: "default",
      leadDays,
      cutoffTime,
      timezone,
      deliveryWindowStart,
      deliveryWindowEnd,
    },
  });

  revalidatePath("/admin/settings");
  revalidatePath("/");
}

// Takes effect within a few seconds (see the cache in src/lib/siteSettings.ts)
// and needs no redeploy. /admin is never gated, so the owner can always
// reach this page to switch it back off.
export async function setMaintenanceMode(formData: FormData) {
  await requireRole(["owner"]);
  const enabled = formData.get("enabled") === "true";

  await prisma.siteSetting.upsert({
    where: { id: "default" },
    update: { maintenanceMode: enabled },
    create: { id: "default", maintenanceMode: enabled },
  });

  revalidatePath("/admin/settings");
}

// Pushes every dish to the WhatsApp catalogue now. The outcome is stored
// and shown on the settings page; dish edits also re-sync on their own.
export async function syncWhatsAppCatalogNow() {
  await requireRole(["owner"]);
  await syncWhatsAppCatalog(await requestOrigin());
  revalidatePath("/admin/settings");
}
