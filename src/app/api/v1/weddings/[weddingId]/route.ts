import type { NextRequest } from "next/server";
import {
  getWeddingHandler,
  updateWeddingHandler,
} from "@/modules/weddings/handlers";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ weddingId: string }> },
) {
  return getWeddingHandler((await context.params).weddingId);
}
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ weddingId: string }> },
) {
  return updateWeddingHandler(request, (await context.params).weddingId);
}
