import { gateway } from "../../../../server/gateway-manager";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ connected: gateway.isConnected() });
}
