import { NextResponse } from "next/server";
import { getTattooDatabase } from "@/lib/database";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export const runtime = "nodejs";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id parameter." }, { status: 400 });
  }

  const database = getTattooDatabase();
  const record = database.find((r) => r.record_id === id);

  if (!record?.image_path) {
    return NextResponse.json({ error: "Record not found." }, { status: 404 });
  }

  const imagePath = record.image_path;
  if (!existsSync(imagePath)) {
    return NextResponse.json({ error: "Image file not found." }, { status: 404 });
  }

  const ext = path.extname(imagePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "image/jpeg";
  const buffer = await readFile(imagePath);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
