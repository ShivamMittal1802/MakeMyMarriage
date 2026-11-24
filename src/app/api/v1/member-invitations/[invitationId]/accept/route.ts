import type { NextRequest } from "next/server";
import { acceptInviteHandler } from "@/modules/weddings/handlers";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ invitationId: string }> },
) {
  return acceptInviteHandler(request, (await context.params).invitationId);
}
