import "server-only";
import { Types, type ClientSession, type HydratedDocument } from "mongoose";
import type { z } from "zod";
import {
  id,
  weddingForMember,
  type AccountActor,
} from "@/modules/weddings/service";
import { ensureWeddingDatabase } from "@/lib/db/wedding-readiness";
import { transaction, duplicateKey } from "@/lib/db/connection";
import { AppError } from "@/lib/http/errors";
import {
  Guest,
  Invitation,
  ensureGuests,
  type GuestRecord,
  type InvitationRecord,
} from "./model";
import { WeddingEvent, ensureEvents } from "@/modules/events/model";
import { cancelInvitationJobs } from "@/modules/email/cancel-invitation-jobs";
import { issueRecoverableToken } from "@/lib/security/token-envelope";
import { EmailJob } from "@/modules/email/models";
import { sealPayload, openPayload } from "@/lib/security/crypto";
import { invalidCursor } from "@/modules/weddings/pagination";
import { guestQuery, selectionQuery, guestCreate, guestPatch } from "./schema";
type Actor = AccountActor;
type GuestDoc = HydratedDocument<GuestRecord>;
type Inv = HydratedDocument<InvitationRecord>;
async function access(actor: Actor, w: string, s?: ClientSession) {
  await ensureWeddingDatabase();
  await ensureGuests();
  await weddingForMember(actor, w, s, false, !!s);
}
const missing = () =>
  new AppError(404, "NOT_FOUND", "This record is no longer available.");
function version(actual: number, expected: number) {
  if (actual !== expected)
    throw new AppError(
      409,
      "VERSION_CONFLICT",
      "This record changed. Review the latest details.",
      { currentVersion: actual },
    );
}
async function guest(w: string, g: string, s?: ClientSession, deleted = false) {
  const doc = await Guest.findOne({
    _id: id(g),
    weddingId: id(w),
    ...(!deleted && { isDeleted: false }),
  }).session(s ?? null);
  if (!doc) throw missing();
  return doc;
}
function dto(g: GuestDoc) {
  return {
    id: String(g._id),
    weddingId: String(g.weddingId),
    name: g.name,
    email: g.emailNormalized ?? undefined,
    phone: g.phone ?? undefined,
    contactRevision: g.contactRevision,
    version: g.version,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}
export type GuestDto = ReturnType<typeof dto>;
async function inviteDtos(rows: Inv[], session?: ClientSession) {
  const jobs = rows.length
    ? await EmailJob.find({
        weddingId: rows[0].weddingId,
        subjectType: "eventInvitation",
        subjectId: { $in: rows.map((i) => i._id) },
        mode: "live",
        state: "accepted",
        acceptedAt: { $type: "date" },
      })
        .select("subjectId kind contactRevision acceptedAt")
        .sort({ acceptedAt: -1 })
        .session(session ?? null)
        .lean()
    : [];
  return rows.map((i) => {
    const current = jobs.filter(
      (j) =>
        i._id.equals(j.subjectId) &&
        j.contactRevision === i.guestContactRevision,
    );
    const invitation = current
        .find((j) => j.kind === "guestInvitation")
        ?.acceptedAt?.toISOString(),
      reminder = current
        .find((j) => j.kind === "guestReminder")
        ?.acceptedAt?.toISOString();
    return {
      id: String(i._id),
      weddingId: String(i.weddingId),
      guestId: String(i.guestId),
      eventId: String(i.eventId),
      status: i.status,
      rsvp: i.rsvp,
      respondedAt: i.respondedAt?.toISOString(),
      guestContactRevision: i.guestContactRevision,
      version: i.version,
      sendStatus: {
        currentAddressInvitationSent: !!invitation,
        currentAddressReminderSent: !!reminder,
        lastInvitationSentAt: invitation,
        lastReminderSentAt: reminder,
      },
    };
  });
}
export type Selection = Awaited<ReturnType<typeof inviteDtos>>[number];
function token(i: Types.ObjectId, w: Types.ObjectId, v: number) {
  return { ...issueRecoverableToken(`rsvp:${w}:${i}:${v}`), version: v };
}
function position(cursor: string | undefined, scope: string) {
  if (!cursor) return;
  try {
    const p = openPayload<{ id: string; name: string; until: number }>(
      JSON.parse(Buffer.from(cursor, "base64url").toString()),
      scope,
    );
    if (p.until < Date.now()) throw invalidCursor();
    return { ...p, id: id(p.id) };
  } catch {
    throw invalidCursor();
  }
}
function page(limit: number, scope: string, id?: Types.ObjectId, name = "") {
  return {
    limit,
    hasMore: !!id,
    nextCursor: id
      ? Buffer.from(
          JSON.stringify(
            sealPayload(
              { id: String(id), name, until: Date.now() + 3600000 },
              scope,
            ),
          ),
        ).toString("base64url")
      : null,
  };
}
export async function listGuests(
  a: Actor,
  w: string,
  input: z.input<typeof guestQuery> = {},
) {
  await access(a, w);
  const { q = "", limit, cursor } = guestQuery.parse(input);
  const scope = JSON.stringify(["guests", a.id, a.sessionVersion, w, q, limit]);
  const p = position(cursor, scope);
  const term = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filter = { $regex: term, $options: "i" };
  const results = await Guest.find({
    weddingId: id(w),
    isDeleted: false,
    $and: [
      q ? { $or: [{ name: filter }, { emailNormalized: filter }] } : {},
      p
        ? {
            $or: [
              { name: { $gt: p.name } },
              { name: p.name, _id: { $gt: p.id } },
            ],
          }
        : {},
    ],
  })
    .sort({ name: 1, _id: 1 })
    .limit(limit + 1);
  const items = results.slice(0, limit),
    last = results.length > limit ? items.at(-1) : undefined;
  return {
    data: items.map(dto),
    page: page(limit, scope, last?._id, last?.name),
  };
}
export async function listSelections(
  a: Actor,
  w: string,
  input: z.input<typeof selectionQuery> = {},
  search = "",
) {
  await access(a, w);
  const { limit, cursor, ...filters } = selectionQuery.parse(input);
  const scope = JSON.stringify([
    "guest-selections",
    a.id,
    a.sessionVersion,
    w,
    limit,
    filters,
    search,
  ]);
  const p = position(cursor, scope);
  const pattern = search.slice(0, 150).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const term = { $regex: pattern, $options: "i" };
  const matching = pattern
    ? await Guest.find({
        weddingId: id(w),
        isDeleted: false,
        $or: [{ name: term }, { emailNormalized: term }],
      }).distinct("_id")
    : undefined;
  const rows = await Invitation.find({
    ...filters,
    ...(matching && { guestId: { $in: matching } }),
    weddingId: id(w),
    ...(p && { _id: { $gt: p.id } }),
  })
    .sort({ _id: 1 })
    .limit(limit + 1);
  const shown = rows.slice(0, limit);
  return {
    data: await inviteDtos(shown),
    page: page(
      limit,
      scope,
      rows.length > limit ? shown.at(-1)?._id : undefined,
    ),
  };
}
async function invitation(w: string, i: string, s?: ClientSession) {
  const doc = await Invitation.findOne({
    _id: id(i),
    weddingId: id(w),
  }).session(s ?? null);
  if (!doc) throw missing();
  return doc;
}
export async function getSelection(a: Actor, w: string, i: string) {
  await access(a, w);
  return (await inviteDtos([await invitation(w, i)]))[0];
}
export async function getGuest(a: Actor, w: string, g: string) {
  await access(a, w);
  return dto(await guest(w, g));
}
async function write<T>(
  a: Actor,
  w: string,
  fn: (s: ClientSession) => Promise<T>,
) {
  await ensureGuests();
  return transaction(async (s) => {
    await access(a, w, s);
    return fn(s);
  });
}
async function uniqueEmail<T>(work: Promise<T>) {
  try {
    return await work;
  } catch (e) {
    if (duplicateKey(e))
      throw new AppError(
        409,
        "DUPLICATE_EMAIL",
        "A guest with this email already exists in this wedding.",
      );
    throw e;
  }
}
export function createGuest(
  a: Actor,
  w: string,
  input: z.infer<typeof guestCreate>,
) {
  const { email, ...v } = guestCreate.parse(input);
  return uniqueEmail(
    write(a, w, async (s) =>
      dto(
        (
          await Guest.create(
            [
              {
                ...v,
                emailNormalized: email,
                weddingId: id(w),
                createdBy: id(a.id),
                updatedBy: id(a.id),
              },
            ],
            { session: s },
          )
        )[0],
      ),
    ),
  );
}
export function editGuest(
  a: Actor,
  w: string,
  g: string,
  input: z.infer<typeof guestPatch>,
) {
  const { expectedVersion, email, phone, name } = guestPatch.parse(input);
  return uniqueEmail(
    write(a, w, async (s) => {
      const doc = await guest(w, g, s);
      version(doc.version, expectedVersion);
      const changed =
        email !== undefined &&
        (email ?? undefined) !== (doc.emailNormalized ?? undefined);
      if (changed) {
        doc.set("emailNormalized", email ?? undefined);
        doc.contactRevision++;
        const active = await Invitation.find({
          weddingId: id(w),
          guestId: doc._id,
          status: "active",
        }).session(s);
        for (const i of active) {
          i.set({
            guestContactRevision: doc.contactRevision,
            token: token(i._id, i.weddingId, i.token.version + 1),
            version: i.version + 1,
          });
          await i.save({ session: s });
        }
        await cancelInvitationJobs(
          id(w),
          active.map((i) => i._id),
          s,
          new Date(),
          "eventInvitation",
          "contactChanged",
        );
      }
      if (name !== undefined) doc.name = name;
      if (phone !== undefined) doc.set("phone", phone ?? undefined);
      doc.updatedBy = id(a.id);
      doc.version++;
      await doc.save({ session: s });
      return {
        data: dto(doc),
        ...(changed && {
          effects: {
            invitationLinksRotated: true,
            rsvpsPreserved: true,
            replacementSendRequired: true,
          },
        }),
      };
    }),
  );
}
export function removeGuest(a: Actor, w: string, g: string, v: number) {
  return write(a, w, async (s) => {
    const doc = await guest(w, g, s, true);
    if (doc.isDeleted) return;
    version(doc.version, v);
    const now = new Date();
    doc.set({
      isDeleted: true,
      deletedAt: now,
      deletedBy: id(a.id),
      updatedBy: id(a.id),
      version: v + 1,
    });
    await doc.save({ session: s });
    const filter = { weddingId: id(w), guestId: doc._id };
    const ids = await Invitation.find(filter).distinct("_id").session(s);
    await Invitation.updateMany(
      { ...filter, status: "active" },
      {
        $set: {
          status: "revoked",
          revokedReason: "guestDeleted",
          revokedAt: now,
          revokedBy: id(a.id),
        },
        $inc: { version: 1 },
      },
      { session: s },
    );
    await cancelInvitationJobs(
      id(w),
      ids,
      s,
      now,
      "eventInvitation",
      "guestDeleted",
    );
  });
}
async function parents(w: string, g: string, e: string, s: ClientSession) {
  await ensureEvents();
  const person = await Guest.findOneAndUpdate(
    { _id: id(g), weddingId: id(w), isDeleted: false },
    { $inc: { version: 1 } },
    { session: s, returnDocument: "after" },
  );
  if (!person) throw missing();
  const event = await WeddingEvent.updateOne(
    { _id: id(e), weddingId: id(w), isDeleted: false },
    { $inc: { version: 1 } },
    { session: s },
  );
  if (!event.modifiedCount) throw missing();
  return person;
}
export function addSelection(a: Actor, w: string, g: string, e: string) {
  return write(a, w, async (s) => {
    const person = await parents(w, g, e, s);
    const filter = { guestId: id(g), eventId: id(e), weddingId: id(w) };
    const existing = await Invitation.findOne(filter).session(s);
    if (existing)
      throw new AppError(
        409,
        "INVITATION_EXISTS",
        "This guest already has a selection for this event.",
        { invitationId: String(existing._id) },
      );
    const key = new Types.ObjectId();
    const [i] = await Invitation.create(
      [
        {
          ...filter,
          _id: key,
          createdBy: id(a.id),
          token: token(key, id(w), 0),
          guestContactRevision: person.contactRevision,
        },
      ],
      { session: s },
    );
    return (await inviteDtos([i], s))[0];
  });
}
export function reactivate(a: Actor, w: string, key: string, v: number) {
  return write(a, w, async (s) => {
    const i = await invitation(w, key, s);
    version(i.version, v);
    if (i.status !== "revoked")
      throw new AppError(
        409,
        "INVITATION_EXISTS",
        "This guest is already on the event list.",
      );
    const person = await parents(w, String(i.guestId), String(i.eventId), s);
    i.set({
      status: "active",
      revokedReason: undefined,
      revokedAt: undefined,
      revokedBy: undefined,
      guestContactRevision: person.contactRevision,
      token: token(i._id, i.weddingId, i.token.version + 1),
      version: v + 1,
    });
    await i.save({ session: s });
    return (await inviteDtos([i], s))[0];
  });
}
export function withdraw(a: Actor, w: string, key: string, v: number) {
  return write(a, w, async (s) => {
    const i = await invitation(w, key, s);
    if (i.status === "revoked") return;
    version(i.version, v);
    i.set({
      status: "revoked",
      revokedReason: "uninvited",
      revokedAt: new Date(),
      revokedBy: id(a.id),
      version: v + 1,
    });
    await i.save({ session: s });
    await cancelInvitationJobs(
      id(w),
      [i._id],
      s,
      new Date(),
      "eventInvitation",
      "uninvited",
    );
  });
}
