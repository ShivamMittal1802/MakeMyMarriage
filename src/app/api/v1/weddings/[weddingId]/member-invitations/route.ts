import type { NextRequest } from "next/server";
import { createInviteHandler } from "@/modules/weddings/handlers";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ weddingId: string }> },
) {
  return createInviteHandler(request, (await context.params).weddingId);
}
