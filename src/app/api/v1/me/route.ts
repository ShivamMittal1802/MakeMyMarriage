import { api, success } from "@/lib/http/api";
import { currentUserDto } from "@/lib/access/account";
export const runtime = "nodejs";
export async function GET() {
  return api(async () => success(await currentUserDto()));
}
