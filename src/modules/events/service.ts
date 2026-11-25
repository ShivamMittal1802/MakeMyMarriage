import "server-only";
import mongoose, { type ClientSession, type HydratedDocument } from "mongoose";
import type { z } from "zod";
import { transaction } from "@/lib/db/connection";
import { ensureWeddingDatabase } from "@/lib/db/wedding-readiness";
import { AppError } from "@/lib/http/errors";
import {
  id,
  weddingForMember,
  type AccountActor,
} from "@/modules/weddings/service";
import { readPosition, writePosition } from "@/modules/weddings/pagination";
import { cancelInvitationJobs } from "@/modules/email/cancel-invitation-jobs";
import { WeddingEvent, ensureEvents, type EventRecord } from "./model";
import {
  createEventSchema,
  patchEventSchema,
  eventListSchema,
  type ScheduleEvent,
} from "./schema";

function dto(event: HydratedDocument<EventRecord>): ScheduleEvent {
  return {
    id: String(event._id),
    weddingId: String(event.weddingId),
    name: event.name,
    location: event.location,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString(),
    description: event.description ?? undefined,
    version: event.version,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}
async function ready() {
  await ensureWeddingDatabase();
  await ensureEvents();
}
async function scopedEvent(
  weddingId: string,
  eventId: string,
  session?: ClientSession,
  includeDeleted = false,
) {
  const event = await WeddingEvent.findOne({
    _id: id(eventId),
    weddingId: id(weddingId),
    ...(!includeDeleted && { isDeleted: false }),
  }).session(session ?? null);
  if (!event)
    throw new AppError(404, "NOT_FOUND", "This event is no longer available.");
  return event;
}
export async function getEvent(
  actor: AccountActor,
  weddingId: string,
  eventId: string,
) {
  await ready();
  await weddingForMember(actor, weddingId);
  return dto(await scopedEvent(weddingId, eventId));
}
export async function listEvents(
  actor: AccountActor,
  weddingId: string,
  options: z.input<typeof eventListSchema> = {},
) {
  await ready();
  await weddingForMember(actor, weddingId);
  const { limit, cursor } = eventListSchema.parse(options);
  const scope = JSON.stringify([
    "events",
    actor.id,
    actor.sessionVersion,
    weddingId,
    limit,
  ]);
  const position = readPosition(cursor, scope);
  const records = await WeddingEvent.find({
    weddingId: id(weddingId),
    isDeleted: false,
    ...(position && {
      $or: [
        { startsAt: { $gt: new Date(position.date) } },
        { startsAt: new Date(position.date), _id: { $gt: id(position.id) } },
      ],
    }),
  })
    .sort({ startsAt: 1, _id: 1 })
    .limit(limit + 1);
  const hasMore = records.length > limit,
    shown = records.slice(0, limit),
    last = shown.at(-1);
  return {
    data: shown.map(dto),
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
function checkRange(start: Date, end?: Date | null) {
  if (end && end < start)
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "End time must be on or after the start.",
      {
        fields: [
          {
            path: "endsAt",
            message: "End time must be on or after the start.",
          },
        ],
      },
    );
}
function checkVersion(current: number, expected: number) {
  if (current !== expected)
    throw new AppError(
      409,
      "VERSION_CONFLICT",
      "This event changed. Review its latest details.",
      { currentVersion: current },
    );
}
export async function createEvent(
  actor: AccountActor,
  weddingId: string,
  input: z.infer<typeof createEventSchema>,
) {
  await ready();
  const values = createEventSchema.parse(input);
  checkRange(
    new Date(values.startsAt),
    values.endsAt ? new Date(values.endsAt) : null,
  );
  return transaction(async (session) => {
    await weddingForMember(actor, weddingId, session, false, true);
    const [event] = await WeddingEvent.create(
      [
        {
          ...values,
          description: values.description || undefined,
          weddingId: id(weddingId),
          createdBy: id(actor.id),
          updatedBy: id(actor.id),
        },
      ],
      { session },
    );
    return dto(event);
  });
}
export async function editEvent(
  actor: AccountActor,
  weddingId: string,
  eventId: string,
  input: z.infer<typeof patchEventSchema>,
) {
  await ready();
  const { expectedVersion, ...changes } = patchEventSchema.parse(input);
  return transaction(async (session) => {
    await weddingForMember(actor, weddingId, session, false, true);
    const event = await scopedEvent(weddingId, eventId, session);
    checkVersion(event.version, expectedVersion);
    event.set(changes);
    if (!event.endsAt) event.set("endsAt", undefined);
    if (!event.description) event.set("description", undefined);
    checkRange(event.startsAt, event.endsAt);
    event.updatedBy = id(actor.id);
    event.version++;
    await event.save({ session });
    return dto(event);
  });
}
export async function deleteEvent(
  actor: AccountActor,
  weddingId: string,
  eventId: string,
  expectedVersion: number,
) {
  await ready();
  await transaction(async (session) => {
    await weddingForMember(actor, weddingId, session, false, true);
    const event = await scopedEvent(weddingId, eventId, session, true);
    if (event.isDeleted) return;
    checkVersion(event.version, expectedVersion);
    const now = new Date();
    event.set({
      isDeleted: true,
      deletedAt: now,
      deletedBy: id(actor.id),
      updatedBy: id(actor.id),
      version: event.version + 1,
    });
    await event.save({ session });
    const invitations = mongoose.connection.db!.collection("eventInvitations");
    const scope = { weddingId: id(weddingId), eventId: event._id };
    const related = await invitations
      .find(scope, { session, projection: { _id: 1 } })
      .toArray();
    if (related.length) {
      await invitations.updateMany(
        { ...scope, status: "active" },
        {
          $set: {
            status: "revoked",
            revokedReason: "eventDeleted",
            revokedAt: now,
            revokedBy: id(actor.id),
            updatedAt: now,
          },
          $inc: { version: 1 },
        },
        { session },
      );
      await cancelInvitationJobs(
        id(weddingId),
        related.map((item) => item._id),
        session,
        now,
        "eventInvitation",
      );
    }
  });
}
