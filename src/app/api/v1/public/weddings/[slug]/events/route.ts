import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/lib/http/api";
import { query } from "@/lib/http/query";
import { publicEvents } from "@/modules/public-weddings/service";
import { eventListSchema } from "@/modules/events/schema";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  return api(async () =>
    NextResponse.json(
      await publicEvents((await params).slug, query(request, eventListSchema)),
    ),
  );
}
