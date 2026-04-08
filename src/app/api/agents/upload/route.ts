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
  ["image/gif", ".gif"],
]);
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_GIF_FRAMES = 24;
const FRAME_SIZE = 160;

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return jsonError(400, "A file field is required");
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return jsonError(400, "Only JPEG, PNG, WEBP, and GIF images are allowed");
  }

  if (file.size > MAX_FILE_SIZE) {
    return jsonError(413, "Image must be 2MB or smaller");
  }

  const raw = Buffer.from(await file.arrayBuffer());

  if (file.type === "image/gif") {
    const metadata = await sharp(raw, { animated: true }).metadata();
    const totalFrames = metadata.pages ?? 1;
    const frameCount = Math.min(totalFrames, MAX_GIF_FRAMES);

    if (frameCount > 1) {
      // 프레임 추출 후 수평 스프라이트시트로 합성
      const frameBuffers: Buffer[] = [];
      for (let i = 0; i < frameCount; i++) {
        const frame = await sharp(raw, { page: i })
          .resize(FRAME_SIZE, FRAME_SIZE, { fit: "cover", position: "centre" })
          .png()
          .toBuffer();
        frameBuffers.push(frame);
      }

      const spritesheet = await sharp({
        create: {
          width: frameCount * FRAME_SIZE,
          height: FRAME_SIZE,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(frameBuffers.map((buf, i) => ({ input: buf, left: i * FRAME_SIZE, top: 0 })))
        .png()
        .toBuffer();

      const filename = `${randomUUID()}_sheet.png`;
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), spritesheet);
      return Response.json({ url: `/api/uploads/${filename}`, frames: frameCount });
    }
  }

  // 정적 이미지 (GIF 단일 프레임 포함)
  const resized = await sharp(raw)
    .resize(FRAME_SIZE, FRAME_SIZE, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();

  const filename = `${randomUUID()}.png`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), resized);
  return Response.json({ url: `/api/uploads/${filename}`, frames: 1 });
}
