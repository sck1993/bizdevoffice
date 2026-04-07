import { loadAll } from "../../../../../server/agent-file-store";
import type { AgentConfig } from "@/types/agent";
import { jsonError } from "@/lib/route-utils";

export const runtime = "nodejs";

/** ws://host:port  →  http://host:port */
function wsUrlToHttp(wsUrl: string): string {
  return wsUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
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
  const agent = agents.find((a) => a.agentId === agentId);
  if (!agent) {
    return jsonError(404, "Agent not found");
  }

  const openclawWsUrl = process.env.OPENCLAW_URL;
  if (!openclawWsUrl) {
    return jsonError(503, "OPENCLAW_URL is not configured");
  }

  const baseUrl = wsUrlToHttp(openclawWsUrl);
  const sessionKey = `clawoffice:chat:${agentId}`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (token) headers["x-openclaw-token"] = token;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({ agentId, prompt, sessionKey }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errMsg = typeof data?.error === "string" ? data.error : `OpenClaw error ${response.status}`;
      console.error("[chat] OpenClaw /v1/responses error:", response.status, data);
      return jsonError(502, errMsg);
    }

    return Response.json({ content: data.response ?? "" });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") {
      return jsonError(504, "Agent response timed out");
    }
    console.error("[chat] OpenClaw fetch error:", error);
    return jsonError(502, "Failed to reach OpenClaw agent");
  } finally {
    clearTimeout(timeout);
  }
}
