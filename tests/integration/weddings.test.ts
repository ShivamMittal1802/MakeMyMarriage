import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { encode } from "next-auth/jwt";
import { currentActor } from "@/lib/access/actor";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { NextRequest } from "next/server";
import { migrateIdentity } from "@/lib/db/migrate-identity";
import { migrateWeddings } from "@/lib/db/migrate-weddings";
import { ensureWeddingDatabase } from "@/lib/db/wedding-readiness";
import { User } from "@/modules/identity/models";
import {
  Wedding,
  Membership,
  MemberInvitation,
} from "@/modules/weddings/models";
import { GalleryAccess } from "@/modules/gallery/access-model";
import {
  createWedding,
  createMemberInvitation,
  shareMemberInvitation,
  exchangeMemberInvitation,
  acceptMemberInvitation,
  getWedding,
  invitationContext,
  type AccountActor,
} from "@/modules/weddings/service";
import {
  setInvitationGrant,
  readInvitationGrant,
} from "@/modules/weddings/invitation-grants";
import { weddingCreateSchema } from "@/modules/weddings/schemas";
import { success } from "@/lib/http/api";
import {
  developmentEmailVerificationEnabled,
  emailVerificationSatisfied,
} from "@/lib/access/email-verification";

const serverContext = vi.hoisted(() => ({ cookie: "", accountId: "" }));
vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: serverContext.accountId } }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: serverContext.cookie }),
  cookies: async () => ({ get: () => undefined }),
}));
let database: MongoMemoryReplSet;
const details = {
  couple: { brideName: "Ananya Sharma", groomName: "Aarav Mehta" },
  weddingDate: "2027-02-21",
  location: "Jaipur, Rajasthan",
  slug: "ananya-aarav",
  creatorRole: "manager" as const,
};
async function actor(email: string, verified = true): Promise<AccountActor> {
  const user = await User.create({
    name: email.split("@")[0],
    emailNormalized: email,
    passwordHash: "isolated-fixture-hash",
    ...(verified ? { emailVerifiedAt: new Date() } : {}),
  });
  return { id: String(user._id), sessionVersion: 0 };
}
async function invite(
  owner: AccountActor,
  weddingId: string,
  email: string,
  role: "bride" | "groom" | "manager" = "manager",
) {
  const record = await createMemberInvitation(owner, weddingId, {
    email,
    role,
  });
  const link = await shareMemberInvitation(owner, weddingId, record.id);
  const token = new URLSearchParams(new URL(link.url).hash.slice(1)).get(
    "token",
  )!;
  return { record, token, ...(await exchangeMemberInvitation(token)) };
}
beforeAll(async () => {
  Object.assign(process.env, {
    AUTH_SECRET: randomBytes(32).toString("base64"),
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    TOKEN_ENCRYPTION_KEY_ID: "wedding-test-key",
    APP_ORIGIN: "http://localhost:3000",
    EMAIL_MODE: "simulated",
    MONGODB_DB_NAME: "weddings_isolated_test",
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
});
beforeEach(async () => {
  for (const collection of await mongoose.connection.db!.collections())
    await collection.deleteMany({});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await mongoose.disconnect();
  await database?.stop();
});

function enableLocalVerificationException() {
  vi.stubEnv("DEV_SKIP_EMAIL_VERIFICATION", "true");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL", "");
}

describe("temporary local development verification", () => {
  it.each([
    ["NODE_ENV", "production"],
    ["NODE_ENV", "test"],
    ["VERCEL", "1"],
    ["APP_ORIGIN", "https://preview.example.com"],
    ["APP_ORIGIN", "not-a-url"],
    ["MONGODB_DB_NAME", "weddings_production"],
    ["MONGODB_URI", ""],
    ["EMAIL_MODE", "test"],
    ["EMAIL_MODE", "live"],
    ["DEV_SKIP_EMAIL_VERIFICATION", "false"],
  ])("does not bypass verification with %s=%s", (key, value) => {
    enableLocalVerificationException();
    vi.stubEnv(key, value);
    expect(developmentEmailVerificationEnabled()).toBe(false);
    expect(emailVerificationSatisfied({})).toBe(false);
    expect(emailVerificationSatisfied({ emailVerifiedAt: new Date() })).toBe(
      true,
    );
  });

  it("allows existing and new development accounts to create/join, and restores verification checks when disabled", async () => {
    const existing = await actor("existing-dev@example.com", false);
    await expect(createWedding(existing, details)).rejects.toMatchObject({
      code: "EMAIL_VERIFICATION_REQUIRED",
    });
    enableLocalVerificationException();
    expect(developmentEmailVerificationEnabled()).toBe(true);
    const wedding = await createWedding(existing, details);
    const helper = await actor("new-dev@example.com", false);
    const invitation = await invite(
      existing,
      wedding.id,
      "new-dev@example.com",
    );
    await expect(
      acceptMemberInvitation(helper, invitation.grant),
    ).resolves.toMatchObject({ userId: helper.id, role: "manager" });
    const records = await User.find({
      _id: { $in: [existing.id, helper.id] },
    });
    expect(records.every((user) => !user.emailVerifiedAt)).toBe(true);
    vi.stubEnv("DEV_SKIP_EMAIL_VERIFICATION", "false");
    await expect(getWedding(existing, wedding.id)).rejects.toMatchObject({
      code: "EMAIL_VERIFICATION_REQUIRED",
    });
    await expect(getWedding(helper, wedding.id)).rejects.toMatchObject({
      code: "EMAIL_VERIFICATION_REQUIRED",
    });
  });
});

describe("transactional wedding onboarding", () => {
  it("creates an owner-manager, wedding, and two distinct encrypted gallery grants atomically", async () => {
    const owner = await actor("owner@example.com");
    const wedding = await createWedding(owner, details);
    expect(wedding).toMatchObject({
      ownerUserId: owner.id,
      slug: details.slug,
      timezone: "Asia/Kolkata",
      currency: "INR",
    });
    expect(await Membership.findOne().lean()).toMatchObject({
      role: "manager",
      status: "active",
    });
    const gallery = await GalleryAccess.find().select("+token");
    expect(gallery.map((item) => item.purpose).sort()).toEqual([
      "upload",
      "view",
    ]);
    expect(gallery[0].token!.hash).not.toBe(gallery[1].token!.hash);
    expect(JSON.stringify(wedding)).not.toMatch(
      /ciphertext|token|passwordHash/,
    );
    expect(
      await createMemberInvitation(owner, wedding.id, {
        email: "helper@example.com",
        role: "manager",
      }),
    ).toMatchObject({ role: "manager" });
  });
  it("keeps couple names independent of account role and permits a bride owner", async () => {
    const owner = await actor("bride@example.com");
    await createWedding(owner, { ...details, creatorRole: "bride" });
    expect((await Membership.findOne())?.role).toBe("bride");
  });
  it("rejects invalid dates, unknown owner fields and invalid slugs", () => {
    expect(
      weddingCreateSchema.safeParse({ ...details, weddingDate: "2027-02-30" })
        .success,
    ).toBe(false);
    expect(
      weddingCreateSchema.safeParse({
        ...details,
        ownerUserId: new mongoose.Types.ObjectId(),
      }).success,
    ).toBe(false);
    expect(
      weddingCreateSchema.safeParse({ ...details, slug: "a/b" }).success,
    ).toBe(false);
    expect(
      weddingCreateSchema.parse({ ...details, slug: "ANANYA-AARAV" }).slug,
    ).toBe("ananya-aarav");
  });
  it("blocks unverified and stale-session actors", async () => {
    const unverified = await actor("unverified@example.com", false);
    await expect(createWedding(unverified, details)).rejects.toMatchObject({
      code: "EMAIL_VERIFICATION_REQUIRED",
    });
    await User.updateOne(
      { _id: unverified.id },
      { $set: { emailVerifiedAt: new Date(), sessionVersion: 1 } },
    );
    await expect(createWedding(unverified, details)).rejects.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
    expect(await Wedding.countDocuments()).toBe(0);
  });
  it("allows only one concurrent create per account and maps slug conflicts without orphan records", async () => {
    const owner = await actor("owner@example.com");
    const result = await Promise.allSettled([
      createWedding(owner, details),
      createWedding(owner, { ...details, slug: "another-wedding" }),
    ]);
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(await Wedding.countDocuments()).toBe(1);
    expect(await Membership.countDocuments()).toBe(1);
    expect(await GalleryAccess.countDocuments()).toBe(2);
    const actual = await Wedding.findOne().orFail();
    const second = await actor("second@example.com");
    await expect(
      createWedding(second, { ...details, slug: actual.slug }),
    ).rejects.toMatchObject({ code: "SLUG_TAKEN" });
    expect(await Membership.countDocuments({ userId: second.id })).toBe(0);
  });
  it("rolls back the wedding and membership if gallery creation fails", async () => {
    const owner = await actor("owner@example.com");
    vi.spyOn(GalleryAccess.collection, "insertOne").mockRejectedValueOnce(
      new Error("isolated insertion failure"),
    );
    await expect(createWedding(owner, details)).rejects.toThrow(
      "isolated insertion failure",
    );
    expect(await Wedding.countDocuments()).toBe(0);
    expect(await Membership.countDocuments()).toBe(0);
    expect(await GalleryAccess.countDocuments()).toBe(0);
    expect((await User.findById(owner.id))?.version).toBe(0);
  });
  it("keeps another wedding inaccessible even to an owner", async () => {
    const first = await actor("first@example.com");
    const second = await actor("second@example.com");
    const wedding = await createWedding(first, details);
    await createWedding(second, { ...details, slug: "other-wedding" });
    await expect(getWedding(second, wedding.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      createMemberInvitation(second, wedding.id, {
        email: "other@example.com",
        role: "manager",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("private management invitations", () => {
  it("exchanges a link without joining, hides the intended email, and accepts idempotently", async () => {
    const owner = await actor("owner@example.com");
    const helper = await actor("helper@example.com");
    const wedding = await createWedding(owner, details);
    const invitation = await invite(owner, wedding.id, "helper@example.com");
    expect(JSON.stringify(invitation.context)).not.toMatch(
      /helper@example.com|ciphertext|token/,
    );
    expect(await Membership.countDocuments()).toBe(1);
    expect(
      (await invitationContext(invitation.grant, helper)).matchesEmail,
    ).toBe(true);
    const accepted = await acceptMemberInvitation(helper, invitation.grant);
    expect(accepted).toMatchObject({
      role: "manager",
      isOwner: false,
      status: "active",
    });
    expect((await acceptMemberInvitation(helper, invitation.grant)).id).toBe(
      accepted.id,
    );
    expect(await Membership.countDocuments()).toBe(2);
    expect(await Wedding.countDocuments()).toBe(1);
    await expect(
      createMemberInvitation(helper, wedding.id, {
        email: "third@example.com",
        role: "bride",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rejects wrong emails, unverified accounts, expired and revoked links", async () => {
    const owner = await actor("owner@example.com");
    const helper = await actor("helper@example.com", false);
    const wrong = await actor("wrong@example.com");
    const wedding = await createWedding(owner, details);
    const invitation = await invite(owner, wedding.id, "helper@example.com");
    await expect(
      acceptMemberInvitation(wrong, invitation.grant),
    ).rejects.toMatchObject({ code: "INVITATION_EMAIL_MISMATCH" });
    await expect(
      acceptMemberInvitation(helper, invitation.grant),
    ).rejects.toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
    await MemberInvitation.updateOne(
      { _id: invitation.record.id },
      { $set: { expiresAt: new Date(Date.now() - 1) } },
    );
    await expect(
      exchangeMemberInvitation(invitation.token),
    ).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
    await expect(
      acceptMemberInvitation(wrong, invitation.grant),
    ).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
    await MemberInvitation.updateOne(
      { _id: invitation.record.id },
      { $set: { status: "revoked", expiresAt: new Date(Date.now() + 60000) } },
    );
    await expect(
      exchangeMemberInvitation(invitation.token),
    ).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
  });
  it("reserves couple roles only at acceptance and permits exactly one concurrent winner", async () => {
    const owner = await actor("owner@example.com");
    const a = await actor("a@example.com");
    const b = await actor("b@example.com");
    const wedding = await createWedding(owner, details);
    const first = await invite(owner, wedding.id, "a@example.com", "bride");
    const second = await invite(owner, wedding.id, "b@example.com", "bride");
    const results = await Promise.allSettled([
      acceptMemberInvitation(a, first.grant),
      acceptMemberInvitation(b, second.grant),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await Membership.countDocuments({
        weddingId: wedding.id,
        status: "active",
        role: "bride",
      }),
    ).toBe(1);
    expect(
      (
        results.find(
          (result) => result.status === "rejected",
        ) as PromiseRejectedResult
      ).reason.code,
    ).toBe("ROLE_TAKEN");
  });
  it("serializes create-versus-join to one active wedding and rolls back losing writes", async () => {
    const owner = await actor("owner@example.com");
    const helper = await actor("helper@example.com");
    const wedding = await createWedding(owner, details);
    const invitation = await invite(owner, wedding.id, "helper@example.com");
    const results = await Promise.allSettled([
      createWedding(helper, { ...details, slug: "helpers-wedding" }),
      acceptMemberInvitation(helper, invitation.grant),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await Membership.countDocuments({ userId: helper.id, status: "active" }),
    ).toBe(1);
    expect(await GalleryAccess.countDocuments()).toBe(
      (await Wedding.countDocuments()) * 2,
    );
  });
  it("allows a removed non-owner to create another wedding but never restores a revoked membership", async () => {
    const owner = await actor("owner@example.com");
    const helper = await actor("helper@example.com");
    const wedding = await createWedding(owner, details);
    const invitation = await invite(owner, wedding.id, "helper@example.com");
    const member = await acceptMemberInvitation(helper, invitation.grant);
    await Membership.updateOne(
      { _id: member.id },
      {
        $set: { status: "revoked", revokedAt: new Date(), revokedBy: owner.id },
      },
    );
    await expect(
      acceptMemberInvitation(helper, invitation.grant),
    ).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
    await expect(
      createWedding(helper, { ...details, slug: "new-celebration" }),
    ).resolves.toMatchObject({ ownerUserId: helper.id });
    expect(
      await Membership.countDocuments({ userId: helper.id, status: "revoked" }),
    ).toBe(1);
  });
  it("expires an old pending invitation before replacement and never sends email", async () => {
    const owner = await actor("owner@example.com");
    const wedding = await createWedding(owner, details);
    const first = await invite(owner, wedding.id, "helper@example.com");
    await expect(
      createMemberInvitation(owner, wedding.id, {
        email: "helper@example.com",
        role: "manager",
      }),
    ).rejects.toMatchObject({ code: "INVITATION_EXISTS" });
    await MemberInvitation.updateOne(
      { _id: first.record.id },
      { $set: { expiresAt: new Date(Date.now() - 1) } },
    );
    const next = await invite(owner, wedding.id, "helper@example.com");
    expect(next.record.id).not.toBe(first.record.id);
    expect((await MemberInvitation.findById(first.record.id))?.status).toBe(
      "expired",
    );
    expect(
      await mongoose.connection.db!.collection("emailJobs").countDocuments(),
    ).toBe(0);
  });
  it("binds encrypted grants to their invitation, purpose and current token version", async () => {
    const owner = await actor("owner@example.com");
    const wedding = await createWedding(owner, details);
    const invitation = await invite(owner, wedding.id, "helper@example.com");
    const bootstrap = new NextRequest(
      "http://localhost:3000/api/v1/access/member-invitation",
    );
    const response = success(invitation.context);
    await setInvitationGrant(
      response,
      bootstrap,
      invitation.grant,
      invitation.context.expiresAt,
    );
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const request = new NextRequest("http://localhost:3000/", {
      headers: { cookie },
    });
    expect(await readInvitationGrant(invitation.record.id, request)).toEqual(
      invitation.grant,
    );
    await expect(
      readInvitationGrant(String(new mongoose.Types.ObjectId()), request),
    ).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
    const tampered = new NextRequest("http://localhost:3000/", {
      headers: { cookie: cookie.replace(/=(.)/, "=x") },
    });
    await expect(
      readInvitationGrant(invitation.record.id, tampered),
    ).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
    await MemberInvitation.updateOne(
      { _id: invitation.record.id },
      { $inc: { "token.version": 1 } },
    );
    await expect(invitationContext(invitation.grant)).rejects.toMatchObject({
      code: "LINK_UNAVAILABLE",
    });
  });
});
it("requires wedding validators and the active-only unique indexes", async () => {
  await mongoose.connection.db!.command({
    collMod: "memberships",
    validator: {},
  });
  await mongoose.disconnect();
  await expect(ensureWeddingDatabase()).rejects.toMatchObject({
    code: "SERVICE_NOT_CONFIGURED",
  });
  await migrateWeddings();
  await ensureWeddingDatabase();
});

it("does not upgrade a revoked JWT if a reset finishes after Auth.js validated the session", async () => {
  const user = await actor("session-race@example.com");
  serverContext.accountId = user.id;
  const name = "authjs.session-token";
  const token = await encode({
    token: { sub: user.id, sessionVersion: 0 },
    secret: process.env.AUTH_SECRET!,
    salt: name,
    maxAge: 600,
  });
  serverContext.cookie = `${name}=${token}`;
  await expect(currentActor()).resolves.toEqual(user);
  // Auth.js has returned the original session snapshot; reset now changes the DB generation.
  await User.updateOne({ _id: user.id }, { $inc: { sessionVersion: 1 } });
  await expect(currentActor()).rejects.toMatchObject({
    code: "AUTHENTICATION_REQUIRED",
  });
});
