import type { NextRequest } from "next/server";
import {
  memberHandler,
  patchMemberHandler,
  removeMemberHandler,
} from "@/modules/weddings/team-handlers";
export const runtime = "nodejs";
type Context = { params: Promise<{ weddingId: string; membershipId: string }> };
export async function GET(_request: NextRequest, context: Context) {
  const { weddingId, membershipId } = await context.params;
  return memberHandler(weddingId, membershipId);
}
export async function PATCH(request: NextRequest, context: Context) {
  const { weddingId, membershipId } = await context.params;
  return patchMemberHandler(request, weddingId, membershipId);
}
export async function DELETE(request: NextRequest, context: Context) {
  const { weddingId, membershipId } = await context.params;
  return removeMemberHandler(request, weddingId, membershipId);
}
