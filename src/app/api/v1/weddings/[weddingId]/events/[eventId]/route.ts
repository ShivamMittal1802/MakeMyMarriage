import type { NextRequest } from "next/server";
import { api, readJson, success } from "@/lib/http/api";
import { currentActor } from "@/lib/access/actor";
import { assertCsrf } from "@/lib/security/csrf";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { query, versionQuery } from "@/lib/http/query";
import { getEvent, editEvent, deleteEvent } from "@/modules/events/service";
import { patchEventSchema } from "@/modules/events/schema";
export const runtime = "nodejs";
type Context = { params: Promise<{ weddingId: string; eventId: string }> };
async function writer(request: NextRequest) {
  assertCsrf(request);
  const actor = await currentActor();
  await consumeRateLimit("event-write", actor.id, 120, 900000);
  return actor;
}
export function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    const { weddingId, eventId } = await params;
    return success(await getEvent(await currentActor(), weddingId, eventId));
  });
}
export function PATCH(request: NextRequest, { params }: Context) {
  return api(async () => {
    const { weddingId, eventId } = await params;
    return success(
      await editEvent(
        await writer(request),
        weddingId,
        eventId,
        await readJson(request, patchEventSchema),
      ),
    );
  });
}
export function DELETE(request: NextRequest, { params }: Context) {
  return api(async () => {
    const { weddingId, eventId } = await params;
    await deleteEvent(
      await writer(request),
      weddingId,
      eventId,
      query(request, versionQuery).expectedVersion,
    );
    return new Response(null, { status: 204 });
  });
}
