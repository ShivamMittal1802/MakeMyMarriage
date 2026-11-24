import { getWeddingHandler } from "@/modules/weddings/handlers";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ weddingId: string }> },
) {
  return getWeddingHandler((await context.params).weddingId);
}
