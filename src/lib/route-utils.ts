export class AgentRouteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const clawGlobal = globalThis as typeof globalThis & {
  __clawIo?: { emit: (event: string, payload: unknown) => void };
};

export function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export function isTimeoutError(error: unknown) {
  return error instanceof Error && error.message.includes("RPC timeout:");
}
