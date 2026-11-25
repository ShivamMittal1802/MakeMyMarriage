import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import sharp from "sharp";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { migrateIdentity } from "@/lib/db/migrate-identity";
import { migrateWeddings } from "@/lib/db/migrate-weddings";
import { User } from "@/modules/identity/models";
import { createWedding, type AccountActor } from "@/modules/weddings/service";
import { Photo, StorageUsage, photoValidator } from "@/modules/gallery/model";
import { GalleryAccess } from "@/modules/gallery/access-model";
import {
  galleryAccess,
  exchangeGallery,
  authorize,
  type PhotoActor,
} from "@/modules/gallery/access";
import {
  initiate,
  complete,
  uploadStatus,
  listPhotos,
  getPhoto,
  deletePhoto,
  cleanupPhoto,
  reconcilePhotos,
} from "@/modules/gallery/service";
vi.mock("@/auth", () => ({ auth: async () => null }));
const store = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  failPreview: false,
  failDelete: "",
}));
vi.mock("@/lib/providers/r2", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/providers/r2")>();
  return {
    ...original,
    signUpload: async (key: string) => ({
      method: "PUT",
      url: "https://storage.invalid/" + key,
      headers: {},
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    signRead: async (key: string) => ({
      url: "https://storage.invalid/" + key,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    }),
    readObject: async (key: string, max: number) => {
      const bytes = store.objects.get(key);
      if (!bytes) {
        const e = new Error();
        e.name = "NoSuchKey";
        throw e;
      }
      if (bytes.length > max) throw new Error("Too large");
      return { bytes, etag: "test-etag" };
    },
    putFinal: async (key: string, bytes: Buffer) => {
      if (store.failPreview && key.endsWith("preview.webp"))
        throw new Error("Provider unavailable");
      if (!store.objects.has(key)) store.objects.set(key, bytes);
    },
    removeObject: async (key: string) => {
      if (key.endsWith(store.failDelete) && store.failDelete)
        throw new Error("Provider unavailable");
      store.objects.delete(key);
    },
  };
});
let database: MongoMemoryReplSet,
  owner: AccountActor,
  actor: PhotoActor,
  w: string,
  bytes: Buffer;
beforeAll(async () => {
  Object.assign(process.env, {
    AUTH_SECRET: randomBytes(32).toString("base64"),
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    TOKEN_ENCRYPTION_KEY_ID: "photo-test",
    APP_ORIGIN: "http://localhost:3000",
    EMAIL_MODE: "simulated",
    MONGODB_DB_NAME: "photos_isolated_test",
    R2_ACCOUNT_ID: "a".repeat(32),
    R2_BUCKET_NAME: "photo-tests",
    R2_ACCESS_KEY_ID: "test-access",
    R2_SECRET_ACCESS_KEY: "test-secret",
    STORAGE_LIMIT_BYTES: "8000000000",
  });
  database = await MongoMemoryReplSet.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? {
          systemBinary: process.env.MONGOMS_SYSTEM_BINARY,
          version: process.env.MONGOMS_VERSION ?? "6.0.10",
        }
      : undefined,
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  process.env.MONGODB_URI = database.getUri();
  await migrateIdentity();
  await migrateWeddings();
  await Photo.createCollection();
  await Photo.createIndexes();
  await mongoose.connection.db!.command({
    collMod: "photos",
    validator: photoValidator,
    validationLevel: "strict",
    validationAction: "error",
  });
  bytes = await sharp({
    create: { width: 64, height: 48, channels: 3, background: "#ac587d" },
  })
    .jpeg()
    .toBuffer();
});
beforeEach(async () => {
  for (const collection of await mongoose.connection.db!.collections())
    await collection.deleteMany({});
  store.objects.clear();
  store.failPreview = false;
  store.failDelete = "";
  process.env.STORAGE_LIMIT_BYTES = "8000000000";
  const user = await User.create({
    name: "Test owner",
    emailNormalized: "owner@example.com",
    passwordHash: "test-fixture",
    emailVerifiedAt: new Date(),
  });
  owner = { id: String(user._id), sessionVersion: 0 };
  actor = { member: owner };
  const wedding = await createWedding(owner, {
    couple: { brideName: "Ananya", groomName: "Aarav" },
    weddingDate: "2027-02-21",
    location: "Jaipur",
    slug: "photo-test",
    creatorRole: "manager",
  });
  w = wedding.id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await database?.stop();
});
const input = () => ({
  filename: "ceremony.jpg",
  contentType: "image/jpeg" as const,
  sizeBytes: bytes.length,
});
async function uploaded(a: PhotoActor = actor) {
  const result = await initiate(a, w, randomUUID(), input());
  const p = (await Photo.findById(result.ticket.photoId))!;
  store.objects.set(p.objects[0].key, bytes);
  return p;
}
async function expireWrite(id: string) {
  await Photo.updateOne(
    { _id: id },
    { $set: { uploadUrlExpiresAt: new Date(Date.now() - 20 * 60_000) } },
  );
}
describe("private photos", () => {
  it("separates upload/view grants and rejects revoked generations", async () => {
    const link = (await galleryAccess(owner, w, "upload")) as { url: string };
    const token = new URLSearchParams(new URL(link.url).hash.slice(1)).get(
      "token",
    )!;
    const grant = await exchangeGallery(token, "upload");
    await expect(exchangeGallery(token, "view")).rejects.toMatchObject({
      status: 404,
    });
    await expect(listPhotos({ grant }, w)).rejects.toMatchObject({
      status: 404,
    });
    const p = await uploaded({ grant });
    expect((await uploadStatus({ grant }, w, String(p._id))).photoId).toBe(
      String(p._id),
    );
    expect(await uploadStatus({ grant }, w, String(p._id))).not.toHaveProperty(
      "preview",
    );
    await GalleryAccess.updateOne(
      { _id: grant.accessId },
      { $inc: { "token.version": 1 } },
    );
    await expect(
      uploadStatus({ grant }, w, String(p._id)),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("rejects cross-wedding and other upload-generation access", async () => {
    const p = await uploaded();
    const access = (await GalleryAccess.findOne({
      weddingId: w,
      purpose: "upload",
    }).select("+token"))!;
    const grant = {
      weddingId: w,
      accessId: String(access._id),
      purpose: "upload" as const,
      generation: access.token.version,
    };
    await expect(
      uploadStatus({ grant }, w, String(p._id)),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      authorize({ grant }, String(new mongoose.Types.ObjectId()), "upload"),
    ).rejects.toMatchObject({ status: 404 });
    const user = await User.create({
      name: "Other",
      emailNormalized: "other@example.com",
      passwordHash: "fixture",
      emailVerifiedAt: new Date(),
    });
    await expect(
      listPhotos({ member: { id: String(user._id), sessionVersion: 0 } }, w),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("replays one concurrent reservation and rejects changed inputs", async () => {
    const key = randomUUID(),
      tickets = await Promise.all([
        initiate(actor, w, key, input()),
        initiate(actor, w, key, input()),
      ]);
    expect(tickets[0].ticket.photoId).toBe(tickets[1].ticket.photoId);
    expect(await Photo.countDocuments()).toBe(1);
    expect((await StorageUsage.findOne())!.reservedBytes).toBe(
      bytes.length * 2 + 2_000_000,
    );
    await expect(
      initiate(actor, w, key, { ...input(), filename: "different.jpg" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await Photo.updateOne(
      { _id: tickets[0].ticket.photoId },
      { $set: { uploadUrlExpiresAt: new Date(0) } },
    );
    expect(
      (await initiate(actor, w, key, input())).ticket.upload,
    ).toBeDefined();
    expect((await StorageUsage.findOne())!.reservedBytes).toBe(
      bytes.length * 2 + 2_000_000,
    );
  });
  it("enforces the shared quota atomically", async () => {
    process.env.STORAGE_LIMIT_BYTES = String(bytes.length * 2 + 2_000_000);
    const results = await Promise.allSettled([
      initiate(actor, w, randomUUID(), input()),
      initiate(actor, w, randomUUID(), input()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await Photo.countDocuments()).toBe(1);
  });
  it("preserves original bytes and finalizes only once", async () => {
    const p = await uploaded();
    expect((await listPhotos(actor, w)).data).toHaveLength(0);
    expect((await complete(actor, w, String(p._id))).state).toBe("ready");
    expect((await listPhotos(actor, w)).page).toEqual({
      limit: 25,
      hasMore: false,
      nextCursor: null,
    });
    const before = (await StorageUsage.findOne())!.storedBytes;
    await complete(actor, w, String(p._id));
    expect((await StorageUsage.findOne())!.storedBytes).toBe(before);
    expect(store.objects.get(p.objects[1].key)).toEqual(bytes);
    expect((await listPhotos(actor, w)).data[0]).toMatchObject({
      filename: "ceremony.jpg",
      sizeBytes: bytes.length,
      width: 64,
      height: 48,
    });
    const download = await getPhoto(actor, w, String(p._id), true);
    expect(download).toHaveProperty(
      "url",
      "https://storage.invalid/" + p.objects[1].key,
    );
    await expireWrite(String(p._id));
    await cleanupPhoto(String(p._id));
    expect((await StorageUsage.findOne())!.storedBytes).toBe(
      before! - bytes.length,
    );
  });
  it("keeps reservations charged on interruption and recovers the promoted original", async () => {
    const p = await uploaded();
    store.failPreview = true;
    await expect(complete(actor, w, String(p._id))).rejects.toMatchObject({
      code: "UPLOAD_INTERRUPTED",
    });
    const active = await uploadStatus(actor, w, String(p._id));
    expect(active.canRetryComplete).toBe(false);
    expect((await StorageUsage.findOne())!.reservedBytes).toBe(
      bytes.length * 2 + 2_000_000,
    );
    await Photo.updateOne(
      { _id: p._id },
      { $set: { "processingLease.until": new Date(0) } },
    );
    expect((await uploadStatus(actor, w, String(p._id))).canRetryComplete).toBe(
      true,
    );
    store.objects.set(p.objects[0].key, Buffer.alloc(bytes.length));
    store.failPreview = false;
    expect((await complete(actor, w, String(p._id))).state).toBe("ready");
    expect(store.objects.get(p.objects[1].key)).toEqual(bytes);
  });
  it("rejects invalid image bytes and releases only confirmed cleanup", async () => {
    const p = await uploaded();
    store.objects.set(p.objects[0].key, Buffer.alloc(bytes.length));
    await expect(complete(actor, w, String(p._id))).rejects.toMatchObject({
      code: "INVALID_IMAGE",
    });
    expect(await cleanupPhoto(String(p._id))).toBe(false);
    expect((await StorageUsage.findOne())!.reservedBytes).toBeGreaterThan(0);
    await expireWrite(String(p._id));
    await cleanupPhoto(String(p._id));
    expect((await StorageUsage.findOne())!.reservedBytes).toBe(0);
  });
  it("hides deleted photos immediately and resumes partially failed cleanup", async () => {
    const p = await uploaded();
    await complete(actor, w, String(p._id));
    const ready = (await Photo.findById(p._id))!;
    await expect(
      deletePhoto(owner, w, String(p._id), ready.version + 1),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(
      await deletePhoto(owner, w, String(p._id), ready.version),
    ).toMatchObject({ cleanupPending: true });
    await expect(getPhoto(actor, w, String(p._id))).rejects.toMatchObject({
      status: 404,
    });
    await expireWrite(String(p._id));
    store.failDelete = "original";
    expect(await deletePhoto(owner, w, String(p._id), 0)).toMatchObject({
      cleanupPending: true,
    });
    expect((await StorageUsage.findOne())!.storedBytes).toBeGreaterThan(0);
    store.failDelete = "";
    await reconcilePhotos();
    expect((await StorageUsage.findOne())!.storedBytes).toBe(0);
    expect(await deletePhoto(owner, w, String(p._id), 0)).toBeNull();
  });
});
