import fs from "fs";
import path from "path";

import type { AgentConfig } from "@/types/agent";
import { agentStateStore } from "../../../../server/agent-state-store";
import { loadAll, saveAll, withLock } from "../../../../server/agent-file-store";
import { gateway } from "../../../../server/gateway-manager";

export const runtime = "nodejs";

const clawGlobal = globalThis as typeof globalThis & {
  __clawIo?: { emit: (event: string, payload: unknown) => void };
};

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

function resolveUploadPath(profileImage: string | null) {
  if (!profileImage?.startsWith("/uploads/")) return null;
  return path.join(process.cwd(), "public", profileImage.replace(/^\/+/, ""));
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await context.params;

  try {
    const removedAgent = await withLock(async () => {
      const existing = loadAll() as AgentConfig[];
      const target = existing.find((agent) => agent.agentId === agentId);

      if (!target) return null;

      try {
        await gateway.agentsDelete(agentId);
      } catch (error) {
        console.error("[agents] remote delete failed, continuing locally:", agentId, error);
      }

      saveAll(existing.filter((agent) => agent.agentId !== agentId));
      return target;
    });

    if (!removedAgent) {
      return jsonError(404, "Agent not found");
    }

    agentStateStore.delete(agentId);

    const uploadPath = resolveUploadPath(removedAgent.profileImage);
    if (uploadPath) {
      fs.promises.unlink(uploadPath).catch((error: NodeJS.ErrnoException) => {
        if (error?.code !== "ENOENT") {
          console.error("[agents] failed to remove profile image:", uploadPath, error);
        }
      });
    }

    clawGlobal.__clawIo?.emit("agent:removed", { agentId });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[agents] unexpected DELETE error:", error);
    return jsonError(500, "Internal server error");
  }
}
