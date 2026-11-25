import { type NextRequest } from "next/server";
import { currentActor } from "@/lib/access/actor";
import { api, success } from "@/lib/http/api";
import { query, versionQuery } from "@/lib/http/query";
import { guestWriter } from "@/modules/guests/writer";
import { getSelection, withdraw } from "@/modules/guests/service";
type Context = { params: Promise<{ weddingId: string; invitationId: string }> };
export function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    const { weddingId, invitationId } = await params;
    return success(
      await getSelection(await currentActor(), weddingId, invitationId),
    );
  });
}
export function DELETE(request: NextRequest, { params }: Context) {
  return api(async () => {
    const { weddingId, invitationId } = await params;
    await withdraw(
      await guestWriter(request),
      weddingId,
      invitationId,
      query(request, versionQuery).expectedVersion,
    );
    return new Response(null, { status: 204 });
  });
}
