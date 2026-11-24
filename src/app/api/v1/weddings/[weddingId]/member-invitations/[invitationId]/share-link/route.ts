import type { NextRequest } from "next/server";
import { shareInviteHandler } from "@/modules/weddings/handlers";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ weddingId: string; invitationId: string }> },
) {
  const { weddingId, invitationId } = await context.params;
  return shareInviteHandler(request, weddingId, invitationId);
}
