"use client";

import { useRef, useState } from "react";

const MAX_EDGE = 1200;
const JPEG_QUALITY = 0.8;

// Phone photos are routinely 5–10MB; shrinking in the browser keeps the
// upload tiny (and well under the server action body limit). The server
// re-validates everything — this is a convenience, not a safeguard.
async function resizeToJpeg(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("Could not encode image.");
  const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}

export default function DishImageField({
  currentImageUrl,
}: {
  currentImageUrl: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState(currentImageUrl);
  const [note, setNote] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) {
      setPreviewUrl(currentImageUrl);
      setNote(null);
      return;
    }

    try {
      const resized = await resizeToJpeg(file);
      const dt = new DataTransfer();
      dt.items.add(resized);
      input.files = dt.files;
      setPreviewUrl(URL.createObjectURL(resized));
      setNote(`${(resized.size / 1024).toFixed(0)} KB after resizing`);
    } catch {
      // Leave the original file in place; the server validates it.
      setPreviewUrl(URL.createObjectURL(file));
      setNote("Couldn't resize this file in the browser; uploading as-is.");
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <span>Photo</span>
      {/* Plain <img>: previews can be blob: URLs, which next/image can't optimize. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={previewUrl}
        alt="Dish photo preview"
        className="h-40 w-40 rounded-md border border-neutral-300 bg-neutral-100 object-cover"
      />
      <input
        ref={inputRef}
        type="file"
        name="imageFile"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleChange}
        className="text-sm"
      />
      <span className="text-xs text-neutral-600">
        {note ?? "Optional. JPEG, PNG or WebP — large photos are shrunk automatically."}
      </span>
    </div>
  );
}
