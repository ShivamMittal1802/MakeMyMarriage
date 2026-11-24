import { getInviteHandler } from "@/modules/weddings/handlers";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ weddingId: string; invitationId: string }> },
) {
  const { weddingId, invitationId } = await context.params;
  return getInviteHandler(weddingId, invitationId);
}
