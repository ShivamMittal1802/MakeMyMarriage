import { api, success } from "@/lib/http/api";
import { publicWedding } from "@/modules/public-weddings/service";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return api(async () => success(await publicWedding((await params).slug)));
}
