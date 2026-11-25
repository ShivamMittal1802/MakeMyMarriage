import "server-only";
import { cache } from "react";
import { Types } from "mongoose";
import { ensureWeddingDatabase } from "@/lib/db/wedding-readiness";
import { AppError } from "@/lib/http/errors";
import { Wedding } from "@/modules/weddings/models";
import { slugSchema } from "@/modules/weddings/schemas";
import { ensureEvents, WeddingEvent } from "@/modules/events/model";
import { eventListSchema } from "@/modules/events/schema";
import { readPosition, writePosition } from "@/modules/weddings/pagination";

function unavailable() {
  return new AppError(404, "NOT_FOUND", "Wedding page unavailable.");
}
// This request-scoped lookup also supplies the internal key for the event query.
// Only the explicitly constructed guest DTOs below leave this module.
const findWedding = cache(async (rawSlug: string) => {
  const slug = slugSchema.safeParse(rawSlug);
  if (!slug.success) throw unavailable();
  await ensureWeddingDatabase();
  const wedding = await Wedding.findOne({ slug: slug.data })
    .select(
      "_id slug couple.brideName couple.groomName weddingDate location introduction timezone youtubeVideoId",
    )
    .lean();
  if (!wedding) throw unavailable();
  return wedding;
});

export async function publicWedding(slug: string) {
  const w = await findWedding(slug);
  const video = w.youtubeVideoId;
  return {
    slug: w.slug,
    couple: { brideName: w.couple!.brideName, groomName: w.couple!.groomName },
    weddingDate: w.weddingDate,
    location: w.location,
    timezone: w.timezone,
    ...(w.introduction && { introduction: w.introduction }),
    ...(video &&
      /^[a-zA-Z0-9_-]{11}$/.test(video) && {
        livestream: {
          embedUrl: `https://www.youtube-nocookie.com/embed/${video}`,
          watchUrl: `https://www.youtube.com/watch?v=${video}`,
        },
      }),
    eventsUrl: `/api/v1/public/weddings/${w.slug}/events`,
  };
}
export async function publicEvents(
  slug: string,
  options: { limit?: number; cursor?: string } = {},
) {
  const wedding = await findWedding(slug);
  const { limit, cursor } = eventListSchema.parse(options);
  const scope = JSON.stringify([
    "public-events",
    wedding.slug,
    String(wedding._id),
    limit,
  ]);
  const after = readPosition(cursor, scope);
  await ensureEvents();
  const rows = await WeddingEvent.find({
    weddingId: wedding._id,
    isDeleted: false,
    ...(after && {
      $or: [
        { startsAt: { $gt: new Date(after.date) } },
        {
          startsAt: new Date(after.date),
          _id: { $gt: new Types.ObjectId(after.id) },
        },
      ],
    }),
  })
    .select("_id name startsAt endsAt location description")
    .sort({ startsAt: 1, _id: 1 })
    .limit(limit + 1)
    .lean();
  const shown = rows.slice(0, limit),
    last = shown.at(-1),
    hasMore = rows.length > limit;
  return {
    data: shown.map((e) => ({
      id: String(e._id),
      name: e.name,
      startsAt: e.startsAt.toISOString(),
      location: e.location,
      ...(e.endsAt && { endsAt: e.endsAt.toISOString() }),
      ...(e.description && { description: e.description }),
    })),
    page: {
      limit,
      hasMore,
      nextCursor:
        hasMore && last
          ? writePosition(String(last._id), last.startsAt, scope)
          : null,
    },
  };
}
export type PublicEventPage = Awaited<ReturnType<typeof publicEvents>>;
