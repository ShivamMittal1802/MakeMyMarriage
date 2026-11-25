import { type NextRequest } from "next/server";
import { api, success, readJson } from "@/lib/http/api";
import { guestWriter } from "@/modules/guests/writer";
import { versionBody } from "@/modules/guests/schema";
import { reactivate } from "@/modules/guests/service";
type Context = { params: Promise<{ weddingId: string; invitationId: string }> };
export function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    const { weddingId, invitationId } = await params;
    return success(
      await reactivate(
        await guestWriter(request),
        weddingId,
        invitationId,
        (await readJson(request, versionBody)).expectedVersion,
      ),
    );
  });
}
