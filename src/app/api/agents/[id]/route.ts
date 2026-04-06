import fs from "fs";
import path from "path";

import type { AgentConfig } from "@/types/agent";
import { agentStateStore } from "../../../../server/agent-state-store";
import { loadAll, saveAll, withLock } from "../../../../server/agent-file-store";
import { gateway } from "../../../../server/gateway-manager";
import { AgentRouteError, clawGlobal, isTimeoutError, jsonError } from "@/lib/route-utils";

export const runtime = "nodejs";

function resolveUploadPath(profileImage: string | null) {
  if (!profileImage?.startsWith("/uploads/")) return null;
  return path.join(process.cwd(), "public", profileImage.replace(/^\/+/, ""));
}

async function removeProfileImage(profileImage: string | null) {
  const uploadPath = resolveUploadPath(profileImage);
  if (!uploadPath) return;

  try {
    await fs.promises.unlink(uploadPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.error("[agents] failed to remove profile image:", uploadPath, error);
    }
  }
}

async function updateAgentFile(agentId: string, fileName: string, content: string) {
  try {
    await gateway.agentsFileSet(agentId, fileName, content);
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new AgentRouteError(504, `Timed out while saving ${fileName}`);
    }
    console.error(`[agents] ${fileName} set failed:`, error);
    throw new AgentRouteError(502, `Failed to save ${fileName}`);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await context.params;

  let body: {
    name?: string;
    identity?: string;
    soul?: string;
    profileImage?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  try {
    const result = await withLock(async () => {
      const existing = loadAll() as AgentConfig[];
      const targetIndex = existing.findIndex((agent) => agent.agentId === agentId);
      if (targetIndex === -1) {
        throw new AgentRouteError(404, "Agent not found");
      }

      const current = existing[targetIndex];
      const nextAgent: AgentConfig = {
        ...current,
        name: body.name === undefined ? current.name : String(body.name).trim(),
        identity: body.identity === undefined ? current.identity : String(body.identity).trim(),
        soul: body.soul === undefined ? current.soul : String(body.soul).trim(),
        profileImage: body.profileImage === undefined ? current.profileImage : body.profileImage,
      };

      if (!nextAgent.name || !nextAgent.identity || !nextAgent.soul) {
        throw new AgentRouteError(400, "name, identity, and soul are required");
      }

      if (nextAgent.profileImage !== null && typeof nextAgent.profileImage !== "string") {
        throw new AgentRouteError(400, "profileImage must be a string or null");
      }

      const identityChanged = nextAgent.identity !== current.identity;
      const soulChanged = nextAgent.soul !== current.soul;

      if ((identityChanged || soulChanged) && !gateway.isConnected()) {
        throw new AgentRouteError(503, "OpenClaw gateway is not connected");
      }

      if (identityChanged) {
        await updateAgentFile(agentId, "IDENTITY.md", nextAgent.identity);
      }

      if (soulChanged) {
        try {
          await updateAgentFile(agentId, "SOUL.md", nextAgent.soul);
        } catch (error) {
          if (identityChanged) {
            try {
              await gateway.agentsFileSet(agentId, "IDENTITY.md", current.identity);
            } catch (rollbackError) {
              console.error("[agents] failed to roll back IDENTITY.md:", rollbackError);
            }
          }
          throw error;
        }
      }

      existing[targetIndex] = nextAgent;
      saveAll(existing);

      return {
        agent: nextAgent,
        previousProfileImage:
          current.profileImage !== nextAgent.profileImage ? current.profileImage : null,
      };
    });

    agentStateStore.set(agentId, {
      name: result.agent.name,
      deskIndex: result.agent.deskIndex,
      spriteImage: result.agent.profileImage ?? null,
    });
    clawGlobal.__clawIo?.emit("agents:snapshot", { agents: agentStateStore.getAll() });
    await removeProfileImage(result.previousProfileImage);

    return Response.json({ agent: result.agent });
  } catch (error) {
    if (error instanceof AgentRouteError) {
      return jsonError(error.status, error.message);
    }

    console.error("[agents] unexpected PATCH error:", error);
    return jsonError(500, "Internal server error");
  }
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
    void removeProfileImage(removedAgent.profileImage);

    clawGlobal.__clawIo?.emit("agent:removed", { agentId });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[agents] unexpected DELETE error:", error);
    return jsonError(500, "Internal server error");
  }
}
