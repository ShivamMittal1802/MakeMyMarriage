import { type NextRequest, NextResponse } from "next/server";
import { currentActor } from "@/lib/access/actor";
import { api, success, readJson } from "@/lib/http/api";
import { query } from "@/lib/http/query";
import { guestWriter } from "@/modules/guests/writer";
import { selectionQuery, selectEvent } from "@/modules/guests/schema";
import { listSelections, addSelection } from "@/modules/guests/service";
type Context = { params: Promise<{ weddingId: string }> };
export function GET(request: NextRequest, { params }: Context) {
  return api(async () => {
    const { weddingId } = await params;
    return NextResponse.json(
      await listSelections(
        await currentActor(),
        weddingId,
        query(request, selectionQuery),
      ),
    );
  });
}
export function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    const { weddingId } = await params;
    const actor = await guestWriter(request);
    const { guestId, eventId } = await readJson(request, selectEvent);
    return created(await addSelection(actor, weddingId, guestId, eventId));
  });
}
function created<T extends { id: string; weddingId: string }>(data: T) {
  const res = success(data, 201);
  res.headers.set(
    "Location",
    `/api/v1/weddings/${data.weddingId}/event-invitations/${data.id}`,
  );
  return res;
}
