export const runtime = "nodejs";

import { jsonError } from "@/lib/route-utils";
import { loadAll } from "../../../../server/agent-file-store";
import { gateway } from "../../../../server/gateway-manager";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MeetingBroker } = require("../../../../server/meeting-broker");

const g = globalThis as typeof globalThis & {
  __clawIo?: { emit: (event: string, payload: unknown) => void };
  __activeMeeting?: { meetingId: string; stop: () => void } | null;
};

export async function POST(req: Request) {
  let body: { topic?: unknown; agentIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  if (typeof body.topic !== "string" || !Array.isArray(body.agentIds)) {
    return jsonError(400, "topic(string)과 agentIds(array)가 필요합니다");
  }

  const topic = body.topic.trim();
  const agentIds = body.agentIds as string[];

  if (!topic) return jsonError(400, "topic이 비어있습니다");
  if (agentIds.length < 2) return jsonError(400, "회의에는 에이전트가 2명 이상 필요합니다");
  if (g.__activeMeeting) return jsonError(409, "이미 진행 중인 회의가 있습니다");
  if (!gateway.isConnected()) return jsonError(503, "OpenClaw 게이트웨이에 연결되지 않았습니다");
  if (!g.__clawIo) return jsonError(503, "Socket.io가 초기화되지 않았습니다");

  const allAgents = loadAll() as Array<{ agentId: string; name: string }>;
  const participants = agentIds
    .map((id) => allAgents.find((a) => a.agentId === id))
    .filter((a): a is { agentId: string; name: string } => !!a);

  if (participants.length < 2) return jsonError(400, "유효한 에이전트가 2명 이상 필요합니다");

  const meetingId = `meet-${Date.now()}`;
  const broker = new MeetingBroker({
    meetingId,
    topic,
    participants,
    gateway,
    io: g.__clawIo,
  });

  g.__activeMeeting = { meetingId, stop: () => broker.stop() };

  broker.run().finally(() => {
    if (g.__activeMeeting?.meetingId === meetingId) {
      g.__activeMeeting = null;
    }
  });

  return Response.json({ meetingId });
}
