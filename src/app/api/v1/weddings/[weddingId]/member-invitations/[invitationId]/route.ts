import { getInviteHandler } from "@/modules/weddings/handlers";
import type { NextRequest } from "next/server";
import { revokeInvitationHandler } from "@/modules/weddings/team-handlers";
export const runtime = "nodejs";
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ weddingId: string; invitationId: string }> },
) {
  const { weddingId, invitationId } = await context.params;
  return revokeInvitationHandler(request, weddingId, invitationId);
}
export async function GET(
  _request: Request,
  context: { params: Promise<{ weddingId: string; invitationId: string }> },
) {
  const { weddingId, invitationId } = await context.params;
  return getInviteHandler(weddingId, invitationId);
}
