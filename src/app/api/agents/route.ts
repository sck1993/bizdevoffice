import type { AgentConfig } from "@/types/agent";
import { agentStateStore } from "../../../server/agent-state-store";
import {
  getNextDeskIndex,
  loadAll,
  saveAll,
  toAgentId,
  withLock,
} from "../../../server/agent-file-store";
import { gateway } from "../../../server/gateway-manager";
import { getDeskCount } from "../../../server/office-file-store";
import { AgentRouteError, clawGlobal, isTimeoutError, jsonError } from "@/lib/route-utils";

export const runtime = "nodejs";

function buildWorkspace(agentId: string) {
  const root = (process.env.OPENCLAW_WORKSPACE_ROOT || "~/.openclaw/workspaces").replace(/\/+$/, "");
  return `${root}/${agentId}`;
}

async function rollbackAgent(agentId: string) {
  try {
    await gateway.agentsDelete(agentId);
  } catch (error) {
    console.error("[agents] rollback delete failed:", agentId, error);
  }
}

export async function GET() {
  return Response.json({ agents: loadAll() as AgentConfig[] });
}

export async function POST(request: Request) {
  let body: {
    name?: string;
    identity?: string;
    soul?: string;
    profileImage?: string | null;
    model?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const name = body.name?.trim();
  const identity = body.identity?.trim();
  const soul = body.soul?.trim();
  const profileImage = body.profileImage ?? null;
  const model = body.model?.trim() || undefined;

  if (!name || !identity || !soul) {
    return jsonError(400, "name, identity, and soul are required");
  }

  try {
    const agent = await withLock(async () => {
      if (!gateway.isConnected()) {
        throw new AgentRouteError(503, "OpenClaw gateway is not connected");
      }

      const existing = loadAll() as AgentConfig[];
      const deskCount = getDeskCount();
      if (existing.length >= deskCount) {
        throw new AgentRouteError(409, `에이전트는 최대 ${deskCount}명까지 생성 가능합니다`);
      }
      const agentId = toAgentId(name, new Set(existing.map((item) => item.agentId)));
      const deskIndex = getNextDeskIndex(existing);
      const createdAt = new Date().toISOString();

      try {
        await gateway.agentsCreate(agentId, buildWorkspace(agentId), model);
      } catch (error) {
        if (isTimeoutError(error)) {
          await rollbackAgent(agentId);
          throw new AgentRouteError(504, "Timed out while creating the agent");
        }
        if (error instanceof Error && error.message === "Gateway not connected") {
          throw new AgentRouteError(503, "OpenClaw gateway is not connected");
        }
        console.error("[agents] agentsCreate failed:", error);
        throw new AgentRouteError(502, "Failed to create agent in OpenClaw");
      }

      try {
        await gateway.agentsFileSet(agentId, "IDENTITY.md", identity);
      } catch (error) {
        await rollbackAgent(agentId);
        if (isTimeoutError(error)) {
          throw new AgentRouteError(504, "Timed out while saving IDENTITY.md");
        }
        console.error("[agents] IDENTITY.md set failed:", error);
        throw new AgentRouteError(502, "Failed to save IDENTITY.md");
      }

      try {
        await gateway.agentsFileSet(agentId, "SOUL.md", soul);
      } catch (error) {
        await rollbackAgent(agentId);
        if (isTimeoutError(error)) {
          throw new AgentRouteError(504, "Timed out while saving SOUL.md");
        }
        console.error("[agents] SOUL.md set failed:", error);
        throw new AgentRouteError(502, "Failed to save SOUL.md");
      }

      const agent: AgentConfig = {
        agentId,
        name,
        identity,
        soul,
        profileImage,
        deskIndex,
        createdAt,
        ...(model ? { model } : {}),
      };

      saveAll([...existing, agent]);
      return agent;
    });

    agentStateStore.set(agent.agentId, {
      agentId: agent.agentId,
      name: agent.name,
      state: "idle",
      deskIndex: agent.deskIndex,
      spriteImage: agent.profileImage ?? null,
    });
    clawGlobal.__clawIo?.emit("agents:snapshot", { agents: agentStateStore.getAll() });

    return Response.json({ agent }, { status: 201 });
  } catch (error) {
    if (error instanceof AgentRouteError) {
      return jsonError(error.status, error.message);
    }

    console.error("[agents] unexpected POST error:", error);
    return jsonError(500, "Internal server error");
  }
}
