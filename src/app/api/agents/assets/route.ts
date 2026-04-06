import fs from "fs";
import path from "path";

export const runtime = "nodejs";

const CHARACTERS_DIR = path.join(process.cwd(), "public", "assets", "characters");
const EXCLUDE = new Set(["agent.png"]); // 스프라이트시트 제외

export async function GET() {
  try {
    const files = fs.readdirSync(CHARACTERS_DIR);
    const assets = files
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !EXCLUDE.has(f))
      .map((f) => `/assets/characters/${f}`);

    return Response.json({ assets });
  } catch {
    return Response.json({ assets: [] });
  }
}
