import type { NextRequest } from "next/server";
import { createInviteHandler } from "@/modules/weddings/handlers";
import { listInvitationsHandler } from "@/modules/weddings/team-handlers";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ weddingId: string }> },
) {
  return listInvitationsHandler(request, (await context.params).weddingId);
}
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ weddingId: string }> },
) {
  return createInviteHandler(request, (await context.params).weddingId);
}
