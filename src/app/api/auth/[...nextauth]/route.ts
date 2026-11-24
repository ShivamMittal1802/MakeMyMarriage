import { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { appOrigin, authSecret } from "@/lib/config/server";
import { api } from "@/lib/http/api";
import { AppError } from "@/lib/http/errors";
import { consumeRateLimit, requestNetworkKey } from "@/lib/security/rate-limit";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return api(async () => {
    authSecret();
    return handlers.GET(request);
  });
}

export async function POST(request: NextRequest) {
  return api(async () => {
    authSecret();
    if (request.headers.get("origin") !== appOrigin())
      throw new AppError(
        403,
        "CSRF_INVALID",
        "Refresh the page and try again.",
      );
    // JWT sign-out and its CSRF bootstrap must work during database outages.
    // Credentials authorization retains its separate account-attempt limiter.
    if (request.nextUrl.pathname === "/api/auth/callback/credentials") {
      await consumeRateLimit(
        "auth-network",
        requestNetworkKey(request),
        100,
        15 * 60_000,
      );
    }
    const reader = request.body?.getReader();
    if (!reader)
      throw new AppError(400, "MALFORMED_JSON", "Missing form data.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 256 * 1024) {
          await reader.cancel();
          throw new AppError(
            413,
            "REQUEST_TOO_LARGE",
            "This request is too large.",
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return handlers.POST(
      new NextRequest(request.url, {
        method: "POST",
        headers: request.headers,
        body: Buffer.concat(chunks),
      }),
    );
  });
}
