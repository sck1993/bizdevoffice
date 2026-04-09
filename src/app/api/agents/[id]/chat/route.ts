import type { AgentConfig } from "@/types/agent";
import { jsonError } from "@/lib/route-utils";
import { loadAll } from "../../../../../server/agent-file-store";
import { appendMessages, loadMessages } from "../../../../../server/chat-file-store";
import { gateway } from "../../../../../server/gateway-manager";

export const runtime = "nodejs";

function buildAgentChatSessionKey(agentId: string) {
  return `clawoffice:chat:${agentId}`;
}

function isChatTimeoutError(error: unknown) {
  return error instanceof Error
    && (error.message === "chat.send timeout" || error.message.includes("RPC timeout:"));
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await context.params;
  const agents = loadAll() as AgentConfig[];
  if (!agents.find((item) => item.agentId === agentId)) {
    return jsonError(404, "Agent not found");
  }
  const messages = loadMessages(agentId);
  return Response.json({ messages });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await context.params;

  let prompt: string;
  try {
    const body = await request.json();
    if (typeof body.prompt !== "string" || !body.prompt.trim()) {
      return jsonError(400, "prompt string is required");
    }
    prompt = body.prompt.trim();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const agents = loadAll() as AgentConfig[];
  const agent = agents.find((item) => item.agentId === agentId);
  if (!agent) {
    return jsonError(404, "Agent not found");
  }

  if (!gateway.isConnected()) {
    return jsonError(503, "Gateway not connected");
  }

  try {
    const content = await gateway.chatSend(
      agentId,
      buildAgentChatSessionKey(agentId),
      prompt,
      undefined,
      agent.model,
    );

    try {
      await appendMessages(agentId, [
        { role: "user", content: prompt },
        { role: "assistant", content },
      ]);
    } catch (saveError) {
      console.error("[chat] failed to save messages:", saveError);
    }

    return Response.json({ content });
  } catch (error) {
    if (error instanceof Error && error.message === "Gateway not connected") {
      return jsonError(503, "Gateway not connected");
    }

    if (isChatTimeoutError(error)) {
      return jsonError(504, "Agent response timed out");
    }

    console.error("[chat] gateway chatSend error:", error);
    return jsonError(502, "Agent chat failed");
  }
}
