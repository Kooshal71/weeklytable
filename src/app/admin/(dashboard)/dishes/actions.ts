"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/dal";
import { syncWhatsAppCatalogAfterResponse } from "@/lib/whatsapp/catalog";
import { Weekday, Category, DietaryTag } from "@/generated/prisma/enums";

const VALID_WEEKDAYS = new Set(Object.values(Weekday));
const VALID_CATEGORIES = new Set(Object.values(Category));
const VALID_DIETARY_TAGS = new Set(Object.values(DietaryTag));

const PLACEHOLDER_IMAGE_URL = "/dishes/placeholder.svg";
const UPLOADED_IMAGE_URL_RE = /^\/api\/dish-images\/([0-9a-f-]{36})$/;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

// The declared MIME type comes from the client, so the real type is decided
// from the file's own leading bytes. SVG is deliberately not accepted.
function detectImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

// Returns the validated upload's bytes + type, or null if no file was chosen.
async function readUploadedImage(formData: FormData) {
  const file = formData.get("imageFile");
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("That photo is too large (3MB maximum).");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = detectImageType(bytes);
  if (!contentType) {
    throw new Error("Photos must be JPEG, PNG or WebP images.");
  }
  return { bytes, contentType };
}

function readDishFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const categoryRaw = String(formData.get("category") ?? "").trim();
  const dietaryTagRaw = String(formData.get("dietaryTag") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const isActive = formData.get("isActive") === "on";
  const availableDays = formData
    .getAll("availableDays")
    .map(String)
    .filter((d): d is Weekday => VALID_WEEKDAYS.has(d as Weekday));

  if (!name || !categoryRaw || !description) {
    throw new Error("Name, category, and description are required.");
  }
  if (!VALID_CATEGORIES.has(categoryRaw as Category)) {
    throw new Error(`"${categoryRaw}" is not a valid category.`);
  }
  if (dietaryTagRaw !== "" && !VALID_DIETARY_TAGS.has(dietaryTagRaw as DietaryTag)) {
    throw new Error(`"${dietaryTagRaw}" is not a valid dietary tag.`);
  }
  if (availableDays.length === 0) {
    throw new Error("Select at least one available day.");
  }

  return {
    name,
    category: categoryRaw as Category,
    dietaryTag: dietaryTagRaw === "" ? null : (dietaryTagRaw as DietaryTag),
    description,
    isActive,
    availableDays,
  };
}

export async function createDish(formData: FormData) {
  await requireRole(["owner"]);
  const data = readDishFields(formData);
  const upload = await readUploadedImage(formData);

  await prisma.$transaction(async (tx) => {
    let imageUrl = PLACEHOLDER_IMAGE_URL;
    if (upload) {
      const image = await tx.dishImage.create({
        data: { data: upload.bytes, contentType: upload.contentType },
      });
      imageUrl = `/api/dish-images/${image.id}`;
    }
    await tx.dish.create({ data: { ...data, imageUrl } });
  });

  await syncWhatsAppCatalogAfterResponse();
  revalidatePath("/admin/dishes");
  revalidatePath("/order");
  revalidatePath("/");
  redirect("/admin/dishes");
}

export async function updateDish(dishId: string, formData: FormData) {
  await requireRole(["owner"]);
  const data = readDishFields(formData);
  const upload = await readUploadedImage(formData);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.dish.findUniqueOrThrow({
      where: { id: dishId },
      select: { imageUrl: true },
    });

    let imageUrl = existing.imageUrl;
    if (upload) {
      const image = await tx.dishImage.create({
        data: { data: upload.bytes, contentType: upload.contentType },
      });
      imageUrl = `/api/dish-images/${image.id}`;
    }

    await tx.dish.update({ where: { id: dishId }, data: { ...data, imageUrl } });

    // The replaced photo is now unreferenced — don't leave its bytes behind.
    const oldUploadId = UPLOADED_IMAGE_URL_RE.exec(existing.imageUrl)?.[1];
    if (upload && oldUploadId) {
      await tx.dishImage.deleteMany({ where: { id: oldUploadId } });
    }
  });

  await syncWhatsAppCatalogAfterResponse();
  revalidatePath("/admin/dishes");
  revalidatePath("/order");
  revalidatePath("/");
  redirect("/admin/dishes");
}

export async function toggleDishActive(dishId: string, isActive: boolean) {
  await requireRole(["owner"]);
  await prisma.dish.update({ where: { id: dishId }, data: { isActive } });
  await syncWhatsAppCatalogAfterResponse();
  revalidatePath("/admin/dishes");
  revalidatePath("/");
}
