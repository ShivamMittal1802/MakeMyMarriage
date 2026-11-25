import { type NextRequest, NextResponse } from "next/server";
import { currentActor } from "@/lib/access/actor";
import { api, success, readJson } from "@/lib/http/api";
import { query } from "@/lib/http/query";
import { guestWriter } from "@/modules/guests/writer";
import { guestQuery, guestCreate } from "@/modules/guests/schema";
import { listGuests, createGuest } from "@/modules/guests/service";
type Context = { params: Promise<{ weddingId: string }> };
export function GET(request: NextRequest, { params }: Context) {
  return api(async () => {
    const { weddingId } = await params;
    return NextResponse.json(
      await listGuests(
        await currentActor(),
        weddingId,
        query(request, guestQuery),
      ),
    );
  });
}
export function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    const { weddingId } = await params;
    return created(
      await createGuest(
        await guestWriter(request),
        weddingId,
        await readJson(request, guestCreate),
      ),
    );
  });
}
function created<T extends { id: string; weddingId: string }>(data: T) {
  const res = success(data, 201);
  res.headers.set(
    "Location",
    `/api/v1/weddings/${data.weddingId}/guests/${data.id}`,
  );
  return res;
}
