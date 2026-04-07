import Anthropic from "@anthropic-ai/sdk";

import { loadAll } from "../../../../../server/agent-file-store";
import type { AgentConfig } from "@/types/agent";
import { jsonError } from "@/lib/route-utils";

export const runtime = "nodejs";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await context.params;

  let messages: ChatMessage[];
  try {
    const body = await request.json();
    if (!Array.isArray(body.messages)) {
      return jsonError(400, "messages array is required");
    }
    messages = body.messages;
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const agents = loadAll() as AgentConfig[];
  const agent = agents.find((a) => a.agentId === agentId);
  if (!agent) {
    return jsonError(404, "Agent not found");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonError(503, "ANTHROPIC_API_KEY is not configured");
  }

  const systemPrompt = [
    `당신의 이름은 "${agent.name}"입니다.`,
    "",
    "## 역할 (Identity)",
    agent.identity,
    "",
    "## 성격 (Soul)",
    agent.soul,
  ].join("\n");

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    return Response.json({ content: text });
  } catch (error) {
    console.error("[chat] Anthropic API error:", error);
    return jsonError(502, "Failed to get response from AI");
  }
}
