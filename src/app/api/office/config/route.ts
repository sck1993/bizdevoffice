export const runtime = "nodejs";

import { loadConfig, saveConfig, withLock } from "../../../../server/office-file-store";
import type { OfficeConfig } from "@/types/office";
import { clawGlobal, jsonError } from "@/lib/route-utils";

export function GET() {
  return Response.json({ config: loadConfig() as OfficeConfig });
}

export async function PUT(request: Request) {
  let body: { config?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const config = body?.config as OfficeConfig | undefined;
  if (!config || !Array.isArray(config.props)) {
    return jsonError(400, "config.props must be an array");
  }

  await withLock(() => saveConfig(config));

  clawGlobal.__clawIo?.emit("office:config", config);

  return Response.json({ ok: true });
}
