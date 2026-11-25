import "server-only";
import type { NextRequest } from "next/server";
import { currentActor } from "@/lib/access/actor";
import { assertCsrf } from "@/lib/security/csrf";
import { consumeRateLimit } from "@/lib/security/rate-limit";
export async function guestWriter(request: NextRequest) {
  assertCsrf(request);
  const actor = await currentActor();
  await consumeRateLimit("guest-write", actor.id, 120, 900000);
  return actor;
}
