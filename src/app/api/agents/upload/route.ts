import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { UPLOADS_DIR } from "../../../../server/agent-file-store";

export const runtime = "nodejs";

const ALLOWED_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);
const MAX_FILE_SIZE = 2 * 1024 * 1024;

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return jsonError(400, "A file field is required");
  }

  const ext = ALLOWED_TYPES.get(file.type);
  if (!ext) {
    return jsonError(400, "Only JPEG, PNG, and WEBP images are allowed");
  }

  if (file.size > MAX_FILE_SIZE) {
    return jsonError(413, "Image must be 2MB or smaller");
  }

  const raw = Buffer.from(await file.arrayBuffer());

  // 160×160으로 리사이징 (canvas 표시 크기 80px의 2배 — 계단 현상 완화)
  const resized = await sharp(raw)
    .resize(160, 160, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();

  const filename = `${randomUUID()}.png`;
  const destPath = path.join(UPLOADS_DIR, filename);

  fs.writeFileSync(destPath, resized);
  return Response.json({ url: `/api/uploads/${filename}` });
}
