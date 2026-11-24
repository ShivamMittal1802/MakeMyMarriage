import type { NextRequest } from "next/server";
import { api } from "@/lib/http/api";
import { csrfBootstrap } from "@/lib/security/csrf";
import { consumeRateLimit, requestNetworkKey } from "@/lib/security/rate-limit";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  return api(async () => {
    await consumeRateLimit(
      "csrf-bootstrap",
      requestNetworkKey(request),
      120,
      15 * 60_000,
    );
    return csrfBootstrap(request);
  });
}
