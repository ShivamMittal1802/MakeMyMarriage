import "server-only";
import { createHash, randomUUID } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { validatePhoto, previewAllowance } from "./image";
import { z } from "zod";
import { transaction, duplicateKey } from "@/lib/db/connection";
import { AppError } from "@/lib/http/errors";
import * as r2 from "@/lib/providers/r2";
import { id, type AccountActor } from "@/modules/weddings/service";
import { readPosition, writePosition } from "@/modules/weddings/pagination";
import { authorize, unavailable, type PhotoActor } from "./access";
import { Photo, StorageUsage, ensurePhotos, type PhotoRecord } from "./model";
import {
  uploadSchema,
  type UploadInput,
  type UploadStatus,
  type GalleryPhoto,
  type PhotoPage,
  type UploadTicket,
} from "./schema";
const leaseMs = 120_000;
const stagingGraceMs = 15 * 60_000;
const conflict = () =>
  new AppError(
    409,
    "UPLOAD_STATE_CONFLICT",
    "This upload can no longer accept new bytes. Check its status or select the photo again.",
  );
function budgetId() {
  const c = r2.storageConfig();
  return (
    "storage:" +
    createHash("sha256")
      .update(c.account + ":" + c.bucket)
      .digest("hex")
      .slice(0, 32)
  );
}
async function prepare() {
  const c = r2.storageConfig();
  await ensurePhotos();
  try {
    await StorageUsage.updateOne(
      { _id: budgetId() },
      {
        $setOnInsert: {
          kind: "storage",
          limitBytes: c.limit,
          storedBytes: 0,
          reservedBytes: 0,
        },
      },
      { upsert: true },
    );
  } catch (e) {
    if (!duplicateKey(e)) throw e;
  }
}
async function usageChange(
  reserved: number,
  stored: number,
  session: ClientSession,
) {
  const c = r2.storageConfig();
  const result = await StorageUsage.updateOne(
    {
      _id: budgetId(),
      $expr: {
        $and: [
          { $gte: [{ $add: ["$reservedBytes", reserved] }, 0] },
          { $gte: [{ $add: ["$storedBytes", stored] }, 0] },
          ...(reserved + stored > 0
            ? [
                {
                  $lte: [
                    {
                      $add: [
                        "$reservedBytes",
                        "$storedBytes",
                        reserved,
                        stored,
                      ],
                    },
                    { $min: ["$limitBytes", c.limit] },
                  ],
                },
              ]
            : []),
        ],
      },
    },
    { $inc: { reservedBytes: reserved, storedBytes: stored, version: 1 } },
    { session },
  );
  if (!result.modifiedCount)
    throw new AppError(
      409,
      "STORAGE_LIMIT_REACHED",
      "The shared photo storage is full. Ask the planning team to remove photos before uploading more.",
    );
}
function assertOwner(a: PhotoActor, p: PhotoRecord) {
  if (
    "grant" in a &&
    (String(p.uploadAccessId) !== a.grant.accessId ||
      p.uploadAccessVersion !== a.grant.generation)
  )
    throw unavailable();
}
async function record(w: string, photoId: string, session?: ClientSession) {
  const p = await Photo.findOne({ _id: id(photoId), weddingId: id(w) }).session(
    session ?? null,
  );
  if (!p) throw unavailable();
  return p;
}
export function status(p: PhotoRecord): UploadStatus {
  const active = (p.processingLease?.until?.getTime() ?? 0) > Date.now();
  return {
    photoId: String(p._id),
    state: p.state,
    ...(p.failureCode && { failureCode: p.failureCode }),
    canRetryComplete:
      ["reserved", "uploaded", "processing"].includes(p.state) &&
      !active &&
      (p.reservation?.expiresAt?.getTime() ?? 0) > Date.now(),
    ...(active && {
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((p.processingLease!.until!.getTime() - Date.now()) / 1000),
      ),
    }),
  };
}
export async function uploadStatus(a: PhotoActor, w: string, photoId: string) {
  await authorize(a, w, "upload");
  await ensurePhotos();
  const p = await record(w, photoId);
  assertOwner(a, p);
  return status(p);
}
export async function initiate(
  a: PhotoActor,
  w: string,
  key: string,
  input: UploadInput,
): Promise<{ ticket: UploadTicket; replay: boolean }> {
  await authorize(a, w, "upload");
  await prepare();
  const data = uploadSchema.parse(input);
  if (data.sizeBytes > r2.storageConfig().maxPhoto)
    throw new AppError(
      413,
      "PHOTO_TOO_LARGE",
      "This photo exceeds the configured upload limit.",
    );
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key))
    throw new AppError(
      422,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Supply a unique upload request key.",
    );
  async function reserve() {
    return transaction(async (session) => {
      await authorize(a, w, "upload", session);
      let p = await Photo.findOne({
        weddingId: id(w),
        clientUploadKey: key,
      }).session(session);
      const replay = !!p;
      if (p) {
        assertOwner(a, p);
        if (
          p.originalFilename !== data.filename ||
          p.declaredBytes !== data.sizeBytes ||
          p.declaredMime !== data.contentType
        )
          throw new AppError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This upload key belongs to a different file.",
          );
        if (
          ["rejected", "deleted", "deleting"].includes(p.state) ||
          (p.state !== "ready" && p.reservation!.expiresAt <= new Date())
        )
          throw conflict();
      } else {
        const photoId = new mongoose.Types.ObjectId(),
          prefix = `weddings/${w}/photos/${photoId}/`,
          reserveBytes = data.sizeBytes * 2 + previewAllowance;
        await usageChange(reserveBytes, 0, session);
        p = new Photo({
          _id: photoId,
          weddingId: id(w),
          clientUploadKey: key,
          ...("member" in a
            ? { uploadedByUserId: id(a.member.id) }
            : {
                uploadAccessId: id(a.grant.accessId),
                uploadAccessVersion: a.grant.generation,
              }),
          originalFilename: data.filename,
          declaredBytes: data.sizeBytes,
          declaredMime: data.contentType,
          state: "reserved",
          objects: [
            {
              kind: "staging",
              key: prefix + "staging",
              bytes: data.sizeBytes,
              state: "reserved",
            },
            {
              kind: "original",
              key: prefix + "original",
              bytes: data.sizeBytes,
              state: "reserved",
            },
            {
              kind: "preview",
              key: prefix + "preview.webp",
              bytes: previewAllowance,
              state: "reserved",
            },
          ],
          reservation: {
            bytes: reserveBytes,
            expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
            state: "active",
          },
          uploadUrlExpiresAt: new Date(0),
        });
      }
      if (p.state === "reserved") {
        p.uploadUrlExpiresAt = new Date(Date.now() + 60_000);
        p.reservation!.expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
        p.increment();
        await p.save({ session });
      }
      return { p, replay };
    });
  }
  let result: Awaited<ReturnType<typeof reserve>>;
  try {
    result = await reserve();
  } catch (e) {
    if (!duplicateKey(e)) throw e;
    result = await reserve();
  }
  const { p, replay } = result,
    base = `/api/v1/gallery/${w}/uploads/${p._id}`;
  return {
    replay,
    ticket: {
      ...status(p),
      statusUrl: base,
      completeUrl: base + "/complete",
      ...(p.state === "reserved" && {
        upload: await r2.signUpload(
          p.objects[0].key,
          p.declaredMime,
          p.declaredBytes,
          Math.max(
            1,
            Math.floor((p.uploadUrlExpiresAt.getTime() - Date.now()) / 1000),
          ),
        ),
      }),
    },
  };
}
export async function complete(a: PhotoActor, w: string, photoId: string) {
  await authorize(a, w, "upload");
  await prepare();
  const leaseId = randomUUID();
  const claimed = await transaction(async (session) => {
    await authorize(a, w, "upload", session);
    const p = await record(w, photoId, session);
    assertOwner(a, p);
    if (p.state === "ready" || p.state === "rejected" || p.state === "deleted")
      return { p, claimed: false };
    if (p.state === "deleting" || p.reservation!.expiresAt <= new Date())
      throw conflict();
    if ((p.processingLease?.until?.getTime() ?? 0) > Date.now())
      return { p, claimed: false };
    p.state = "processing";
    p.processingLease = { id: leaseId, until: new Date(Date.now() + leaseMs) };
    p.failureCode = undefined;
    p.increment();
    await p.save({ session });
    return { p, claimed: true };
  });
  if (!claimed.claimed) return status(claimed.p);
  const p = claimed.p,
    signal = AbortSignal.timeout(50_000);
  try {
    // A previous request may have promoted the original before its response was lost.
    // Reuse that immutable object rather than trusting the writable staging key again.
    let original;
    try {
      original = await r2.readObject(p.objects[1].key, p.declaredBytes, signal);
    } catch (e) {
      if (!r2.missingObject(e)) throw e;
      original = await r2.readObject(p.objects[0].key, p.declaredBytes, signal);
    }
    if (original.bytes.length !== p.declaredBytes)
      throw new AppError(
        422,
        "PHOTO_SIZE_MISMATCH",
        "The uploaded file size changed. Select the original file again.",
      );
    const image = await validatePhoto(original.bytes, p.declaredMime);
    signal.throwIfAborted();
    await r2.putFinal(p.objects[1].key, original.bytes, image.mime, signal);
    await r2.putFinal(p.objects[2].key, image.preview, "image/webp", signal);
    await transaction(async (session) => {
      const row = await record(w, photoId, session);
      if (
        row.state !== "processing" ||
        row.processingLease?.id !== leaseId ||
        row.processingLease.until! <= new Date()
      )
        throw conflict();
      const bytes = row.declaredBytes * 2 + image.preview.length;
      await usageChange(-row.reservation!.bytes, bytes, session);
      row.objects[0].state = "present";
      row.objects[1].state = "present";
      row.objects[2].state = "present";
      row.objects[2].bytes = image.preview.length;
      row.reservation!.bytes = 0;
      row.reservation!.state = "released";
      row.verifiedMime = image.mime;
      row.width = image.width;
      row.height = image.height;
      row.checksumSha256 = createHash("sha256")
        .update(original.bytes)
        .digest("hex");
      row.state = "ready";
      row.processingLease = undefined;
      row.increment();
      await row.save({ session });
    });
    return status(await record(w, photoId));
  } catch (e) {
    // Keep every reserved byte charged on an uncertain provider outcome. Recovery is explicit.
    const rejected = e instanceof AppError && [413, 422].includes(e.status);
    await Photo.updateOne(
      { _id: p._id, state: "processing", "processingLease.id": leaseId },
      {
        $set: {
          state: rejected ? "rejected" : "processing",
          failureCode: rejected ? e.code : "UPLOAD_INTERRUPTED",
        },
        ...(rejected && { $unset: { processingLease: "" } }),
        $inc: { version: 1 },
      },
    );
    if (rejected) throw e;
    throw new AppError(
      503,
      "UPLOAD_INTERRUPTED",
      "Upload processing was interrupted. Check its status, then retry completion when available.",
      { photoId },
    );
  }
}
export async function photoDto(p: PhotoRecord): Promise<GalleryPhoto> {
  return {
    id: String(p._id),
    filename: p.originalFilename,
    contentType: p.verifiedMime!,
    sizeBytes: p.declaredBytes,
    width: p.width!,
    height: p.height!,
    createdAt: p.createdAt.toISOString(),
    version: p.version,
    preview: await r2.signRead(p.objects[2].key),
  };
}
export async function listPhotos(
  a: PhotoActor,
  w: string,
  input: Record<string, unknown> = {},
): Promise<PhotoPage> {
  await authorize(a, w, "view");
  await prepare();
  const parsed = z
    .strictObject({
      limit: z.coerce.number().int().min(1).max(100).default(25),
      cursor: z.string().optional(),
    })
    .safeParse(input);
  if (!parsed.success)
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "Check the gallery pagination.",
    );
  const { limit, cursor } = parsed.data,
    scope = JSON.stringify(["gallery", w, a, limit]),
    pos = readPosition(cursor, scope);
  const rows = await Photo.find({
    weddingId: id(w),
    state: "ready",
    ...(pos && {
      $or: [
        { createdAt: { $lt: new Date(pos.date) } },
        { createdAt: new Date(pos.date), _id: { $lt: id(pos.id) } },
      ],
    }),
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1);
  const hasMore = rows.length > limit,
    page = rows.slice(0, limit),
    last = page.at(-1);
  return {
    data: await Promise.all(page.map(photoDto)),
    page: {
      limit,
      hasMore,
      nextCursor:
        hasMore && last
          ? writePosition(String(last._id), last.createdAt, scope)
          : null,
    },
  };
}
export async function getPhoto(
  a: PhotoActor,
  w: string,
  photoId: string,
  download = false,
) {
  await authorize(a, w, "view");
  await ensurePhotos();
  const p = await record(w, photoId);
  if (p.state !== "ready") throw unavailable();
  return download
    ? {
        ...(await r2.signRead(p.objects[1].key, p.originalFilename)),
        filename: p.originalFilename,
      }
    : photoDto(p);
}
// Bounded maintenance and repeated member DELETE share this idempotent cleanup.
export async function cleanupPhoto(photoId: string) {
  const p = await Photo.findById(photoId);
  if (!p) return true;
  if (!["ready", "rejected", "deleting", "deleted"].includes(p.state))
    return false;
  // A signed PUT can recreate staging until expiry. Also allow in-flight transfers to settle.
  if (p.uploadUrlExpiresAt.getTime() + stagingGraceMs > Date.now())
    return false;
  const targets = p.objects.filter(
    (o) =>
      o.state !== "deleted" && (p.state !== "ready" || o.kind === "staging"),
  );
  for (const o of targets) {
    try {
      await r2.removeObject(o.key);
    } catch {
      return false;
    }
    await transaction(async (session) => {
      const row = await record(String(p.weddingId), String(p._id), session),
        item = row.objects.find((v) => v.kind === o.kind)!;
      if (item.state === "deleted") return;
      if (item.state === "reserved") {
        await usageChange(-item.bytes, 0, session);
        row.reservation!.bytes -= item.bytes;
      } else await usageChange(0, -item.bytes, session);
      item.state = "deleted";
      if (row.objects.every((v) => v.state === "deleted")) {
        row.reservation!.state = "released";
        if (row.state === "deleting") row.state = "deleted";
      }
      row.increment();
      await row.save({ session });
    });
  }
  return true;
}
export async function deletePhoto(
  a: AccountActor,
  w: string,
  photoId: string,
  expectedVersion: number,
) {
  await authorize({ member: a }, w, "view");
  await prepare();
  await transaction(async (session) => {
    await authorize({ member: a }, w, "view", session);
    const p = await record(w, photoId, session);
    if (["deleting", "deleted"].includes(p.state)) return;
    if (p.state !== "ready") throw conflict();
    if (p.version !== expectedVersion)
      throw new AppError(
        409,
        "VERSION_CONFLICT",
        "This photo changed. Refresh the gallery before removing it.",
      );
    p.state = "deleting";
    p.deletedAt = new Date();
    p.deletedBy = id(a.id);
    p.increment();
    await p.save({ session });
  });
  return (await cleanupPhoto(photoId))
    ? null
    : { photoId, state: "deleting", cleanupPending: true };
}
export async function reconcilePhotos() {
  await prepare();
  const rows = await Photo.find({
    $or: [
      {
        state: { $in: ["rejected", "deleting"] },
        objects: { $elemMatch: { state: { $ne: "deleted" } } },
      },
      {
        state: "ready",
        objects: { $elemMatch: { kind: "staging", state: { $ne: "deleted" } } },
      },
      {
        state: { $in: ["reserved", "uploaded", "processing"] },
        "reservation.expiresAt": { $lt: new Date() },
      },
    ],
  })
    .sort({ "reservation.expiresAt": 1 })
    .limit(50);
  for (const p of rows) {
    if (["reserved", "uploaded", "processing"].includes(p.state))
      await Photo.updateOne(
        {
          _id: p._id,
          version: p.version,
          $or: [
            { "processingLease.until": { $lt: new Date() } },
            { "processingLease.until": { $exists: false } },
          ],
        },
        {
          $set: { state: "rejected", failureCode: "UPLOAD_EXPIRED" },
          $inc: { version: 1 },
        },
      );
    await cleanupPhoto(String(p._id));
  }
  return rows.length;
}
