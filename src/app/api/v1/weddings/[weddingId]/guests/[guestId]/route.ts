import { type NextRequest, NextResponse } from "next/server";
import { currentActor } from "@/lib/access/actor";
import { api, success, readJson } from "@/lib/http/api";
import { query, versionQuery } from "@/lib/http/query";
import { guestWriter } from "@/modules/guests/writer";
import { guestPatch } from "@/modules/guests/schema";
import { getGuest, editGuest, removeGuest } from "@/modules/guests/service";
type Context = { params: Promise<{ weddingId: string; guestId: string }> };
export function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    const { weddingId, guestId } = await params;
    return success(await getGuest(await currentActor(), weddingId, guestId));
  });
}
export function PATCH(request: NextRequest, { params }: Context) {
  return api(async () => {
    const { weddingId, guestId } = await params;
    return NextResponse.json(
      await editGuest(
        await guestWriter(request),
        weddingId,
        guestId,
        await readJson(request, guestPatch),
      ),
    );
  });
}
export function DELETE(request: NextRequest, { params }: Context) {
  return api(async () => {
    const { weddingId, guestId } = await params;
    await removeGuest(
      await guestWriter(request),
      weddingId,
      guestId,
      query(request, versionQuery).expectedVersion,
    );
    return new Response(null, { status: 204 });
  });
}
