import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public on purpose, like the menu itself. Each upload gets its own id and
// is never edited afterwards, so the response can be cached forever.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const image = await prisma.dishImage.findUnique({
    where: { id },
    select: { data: true, contentType: true },
  });

  if (!image) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }

  return new Response(Buffer.from(image.data), {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
