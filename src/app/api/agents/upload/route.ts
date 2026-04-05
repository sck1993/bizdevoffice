import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
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

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = `${randomUUID()}${ext}`;
  const destPath = path.join(UPLOADS_DIR, filename);

  fs.writeFileSync(destPath, buffer);
  return Response.json({ url: `/uploads/${filename}` });
}
