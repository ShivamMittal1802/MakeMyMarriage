import type { NextRequest } from "next/server";
import { listMembersHandler } from "@/modules/weddings/team-handlers";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ weddingId: string }> },
) {
  return listMembersHandler(request, (await context.params).weddingId);
}
