import { NextResponse, type NextRequest } from "next/server";
import { api, readJson, success } from "@/lib/http/api";
import { query } from "@/lib/http/query";
import { currentActor } from "@/lib/access/actor";
import { assertCsrf } from "@/lib/security/csrf";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { listEvents, createEvent } from "@/modules/events/service";
import { eventListSchema, createEventSchema } from "@/modules/events/schema";
export const runtime = "nodejs";
type Context = { params: Promise<{ weddingId: string }> };
export function GET(request: NextRequest, { params }: Context) {
  return api(async () =>
    NextResponse.json(
      await listEvents(
        await currentActor(),
        (await params).weddingId,
        query(request, eventListSchema),
      ),
    ),
  );
}
export function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    assertCsrf(request);
    const actor = await currentActor();
    await consumeRateLimit("event-write", actor.id, 120, 900000);
    const event = await createEvent(
      actor,
      (await params).weddingId,
      await readJson(request, createEventSchema),
    );
    const response = success(event, 201);
    response.headers.set(
      "Location",
      `/api/v1/weddings/${event.weddingId}/events/${event.id}`,
    );
    return response;
  });
}
