export const runtime = "nodejs";

import { jsonError } from "@/lib/route-utils";

const g = globalThis as typeof globalThis & {
  __activeMeeting?: { meetingId: string; stop: () => void } | null;
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const meetingId: string | undefined = body?.meetingId;

  if (!g.__activeMeeting) {
    return jsonError(404, "진행 중인 회의가 없습니다");
  }
  if (meetingId && g.__activeMeeting.meetingId !== meetingId) {
    return jsonError(404, "해당 meetingId의 회의를 찾을 수 없습니다");
  }

  g.__activeMeeting.stop();
  return Response.json({ ok: true });
}
