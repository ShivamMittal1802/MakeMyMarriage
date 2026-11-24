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
import { EmailJob, EmailOperation, Usage } from "@/modules/email/models";
import { sealPayload } from "@/lib/security/crypto";
import {
  listMembers,
  getMember,
  listMemberInvitations,
  changeMemberRole,
  removeMember,
  revokeMemberInvitation,
} from "@/modules/weddings/team-service";
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
    ).toBe("ROLE_OCCUPIED");
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

describe("planning team administration", () => {
  async function setup(role: "bride" | "groom" | "manager" = "manager") {
    const owner = await actor("team-owner@example.com");
    const wedding = await createWedding(owner, details);
    const helper = await actor("team-helper@example.com");
    const invitation = await invite(
      owner,
      wedding.id,
      "team-helper@example.com",
      role,
    );
    const member = await acceptMemberInvitation(helper, invitation.grant);
    return { owner, wedding, helper, invitation, member };
  }
  it("paginates active members deterministically without exposing emails, and binds cursors to access/filter/resource", async () => {
    const { owner, wedding, helper } = await setup();
    for (let n = 0; n < 3; n++) {
      const person = await actor(`roster-${n}@example.com`);
      await Membership.create({
        weddingId: wedding.id,
        userId: person.id,
        role: "manager",
        joinedAt: new Date("2026-01-01T00:00:00Z"),
      });
    }
    const first = await listMembers(owner, wedding.id, { limit: 2 });
    expect(first.page).toMatchObject({ limit: 2, hasMore: true });
    const second = await listMembers(owner, wedding.id, {
      limit: 2,
      cursor: first.page.nextCursor,
    });
    const third = await listMembers(owner, wedding.id, {
      limit: 2,
      cursor: second.page.nextCursor,
    });
    const ids = [...first.data, ...second.data, ...third.data].map(
      (item) => item.id,
    );
    expect(new Set(ids).size).toBe(5);
    expect(third.page).toMatchObject({ hasMore: false, nextCursor: null });
    expect(JSON.stringify(first)).not.toMatch(
      /email|password|sessionVersion|ciphertext|token/,
    );
    await expect(
      listMembers(helper, wedding.id, {
        limit: 2,
        cursor: first.page.nextCursor,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(
      listMembers(owner, wedding.id, {
        limit: 2,
        status: "revoked",
        cursor: first.page.nextCursor,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(
      listMemberInvitations(owner, wedding.id, {
        limit: 2,
        cursor: first.page.nextCursor,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(
      listMembers(owner, wedding.id, { cursor: "tampered" }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    const other = await actor("other-owner@example.com");
    const otherWedding = await createWedding(other, {
      ...details,
      slug: "other-team",
    });
    await expect(listMembers(owner, otherWedding.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("keeps pending invitation email lists/admin history private and hides elapsed pending links", async () => {
    const { owner, wedding, helper, member } = await setup();
    const expired = await createMemberInvitation(owner, wedding.id, {
      email: "elapsed@example.com",
      role: "manager",
    });
    await MemberInvitation.updateOne(
      { _id: expired.id },
      { $set: { expiresAt: new Date(0) } },
    );
    await createMemberInvitation(owner, wedding.id, {
      email: "pending@example.com",
      role: "manager",
    });
    const page = await listMemberInvitations(owner, wedding.id);
    expect(page.data.map((item) => item.email)).toEqual([
      "pending@example.com",
    ]);
    const history = await listMemberInvitations(owner, wedding.id, {
      status: "expired",
    });
    expect(history.data[0]).toMatchObject({
      id: expired.id,
      status: "expired",
    });
    expect(JSON.stringify(page)).not.toMatch(/ciphertext|nonce|token|password/);
    await expect(
      listMemberInvitations(helper, wedding.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      listMembers(helper, wedding.id, { status: "revoked" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      changeMemberRole(helper, wedding.id, member.id, {
        expectedVersion: member.version,
        role: "bride",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("protects owner membership/role and enforces version/role-slot conflicts", async () => {
    const { owner, wedding, helper, member } = await setup();
    const ownerRecord = await Membership.findOne({ userId: owner.id }).orFail();
    await expect(
      changeMemberRole(owner, wedding.id, String(ownerRecord._id), {
        expectedVersion: ownerRecord.version,
        role: "bride",
      }),
    ).rejects.toMatchObject({ code: "OWNER_PROTECTED" });
    await expect(
      removeMember(
        owner,
        wedding.id,
        String(ownerRecord._id),
        ownerRecord.version,
      ),
    ).rejects.toMatchObject({ code: "OWNER_PROTECTED" });
    const changed = await changeMemberRole(owner, wedding.id, member.id, {
      expectedVersion: member.version,
      role: "bride",
    });
    expect(changed).toMatchObject({ role: "bride", isOwner: false });
    await expect(
      changeMemberRole(owner, wedding.id, member.id, {
        expectedVersion: member.version,
        role: "manager",
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const next = await actor("second-role@example.com");
    const nextMembership = await Membership.create({
      weddingId: wedding.id,
      userId: next.id,
      role: "manager",
    });
    await expect(
      changeMemberRole(owner, wedding.id, String(nextMembership._id), {
        expectedVersion: 0,
        role: "bride",
      }),
    ).rejects.toMatchObject({ code: "ROLE_OCCUPIED" });
    await expect(
      removeMember(
        helper,
        wedding.id,
        String(ownerRecord._id),
        ownerRecord.version,
      ),
    ).rejects.toMatchObject({ code: "OWNER_PROTECTED" });
  });
  it("handles self-demotion and self-removal using current fenced versions", async () => {
    const { owner, wedding, helper, member } = await setup("bride");
    const demoted = await changeMemberRole(helper, wedding.id, member.id, {
      expectedVersion: member.version,
      role: "manager",
    });
    expect(demoted).toMatchObject({
      role: "manager",
      version: member.version + 2,
    });
    await expect(
      createMemberInvitation(helper, wedding.id, {
        email: "forbidden@example.com",
        role: "manager",
      }),
    ).rejects.toMatchObject({ status: 403 });
    const groom = await actor("groom-admin@example.com");
    const invitation = await invite(
      owner,
      wedding.id,
      "groom-admin@example.com",
      "groom",
    );
    const groomMember = await acceptMemberInvitation(groom, invitation.grant);
    await removeMember(groom, wedding.id, groomMember.id, groomMember.version);
    await expect(
      removeMember(groom, wedding.id, groomMember.id, groomMember.version),
    ).rejects.toMatchObject({ status: 404 });
    await expect(getWedding(groom, wedding.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await Membership.findById(groomMember.id)).toMatchObject({
      status: "revoked",
      revokedBy: new mongoose.Types.ObjectId(groom.id),
    });
    await expect(
      createWedding(groom, { ...details, slug: "groom-next-wedding" }),
    ).resolves.toHaveProperty("id");
  });
  it("removes access, invalidates pending re-entry grants, and rejoins with a fresh historical membership", async () => {
    const { owner, wedding, helper, member } = await setup();
    const reentry = await invite(owner, wedding.id, "team-helper@example.com");
    await removeMember(owner, wedding.id, member.id, member.version);
    const old = await Membership.findById(member.id).orFail();
    expect(old).toMatchObject({
      status: "revoked",
      revokedBy: new mongoose.Types.ObjectId(owner.id),
    });
    expect(old.revokedAt).toBeInstanceOf(Date);
    await expect(getWedding(helper, wedding.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      acceptMemberInvitation(helper, reentry.grant),
    ).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
    await expect(exchangeMemberInvitation(reentry.token)).rejects.toMatchObject(
      { code: "LINK_UNAVAILABLE" },
    );
    const replacement = await invite(
      owner,
      wedding.id,
      "team-helper@example.com",
    );
    const joined = await acceptMemberInvitation(helper, replacement.grant);
    expect(joined.id).not.toBe(member.id);
    expect(await Membership.countDocuments({ userId: helper.id })).toBe(2);
    expect((await listMembers(owner, wedding.id)).data).toHaveLength(2);
    expect(
      (await listMembers(owner, wedding.id, { status: "revoked" })).data[0],
    ).toHaveProperty("revokedBy", owner.id);
    await expect(
      getMember(helper, wedding.id, member.id),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("revokes invitations with version checks and preserves accepted memberships", async () => {
    const { owner, wedding, helper, invitation, member } = await setup();
    await expect(
      revokeMemberInvitation(
        owner,
        wedding.id,
        invitation.record.id,
        invitation.record.version,
      ),
    ).rejects.toMatchObject({ code: "INVITATION_ACCEPTED" });
    expect((await getMember(owner, wedding.id, member.id)).status).toBe(
      "active",
    );
    const pending = await invite(owner, wedding.id, "revoke@example.com");
    await expect(
      revokeMemberInvitation(owner, wedding.id, pending.record.id, 50),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      revokeMemberInvitation(helper, wedding.id, pending.record.id, 0),
    ).rejects.toMatchObject({ status: 403 });
    await revokeMemberInvitation(
      owner,
      wedding.id,
      pending.record.id,
      pending.record.version,
    );
    await expect(exchangeMemberInvitation(pending.token)).rejects.toMatchObject(
      { code: "LINK_UNAVAILABLE" },
    );
    const candidate = await actor("revoke@example.com");
    await expect(
      acceptMemberInvitation(candidate, pending.grant),
    ).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
  });
  it("repeats member removal without changing history or removing a fresh membership", async () => {
    const { owner, wedding, helper, member } = await setup();
    await expect(
      removeMember(owner, wedding.id, member.id, member.version + 1),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await removeMember(owner, wedding.id, member.id, member.version);
    const removed = await Membership.findById(member.id).lean().orFail();
    const replacement = await invite(
      owner,
      wedding.id,
      "team-helper@example.com",
    );
    const rejoined = await acceptMemberInvitation(helper, replacement.grant);

    await expect(
      removeMember(owner, wedding.id, member.id, member.version),
    ).resolves.toBeUndefined();
    expect(await Membership.findById(member.id).lean()).toEqual(removed);
    expect((await getMember(owner, wedding.id, rejoined.id)).status).toBe(
      "active",
    );
    await expect(
      changeMemberRole(owner, wedding.id, member.id, {
        expectedVersion: removed.version,
        role: "bride",
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      removeMember(helper, wedding.id, member.id, member.version),
    ).rejects.toMatchObject({ status: 403 });

    const other = await actor("delete-other@example.com");
    const otherWedding = await createWedding(other, {
      ...details,
      slug: "delete-other-wedding",
    });
    await expect(
      removeMember(other, otherWedding.id, member.id, member.version),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("repeats invitation revocation without revoking a replacement or bypassing access checks", async () => {
    const { owner, wedding, helper } = await setup();
    const original = await invite(
      owner,
      wedding.id,
      "repeat-revoke@example.com",
    );
    await revokeMemberInvitation(
      owner,
      wedding.id,
      original.record.id,
      original.record.version,
    );
    const revoked = await MemberInvitation.findById(original.record.id)
      .lean()
      .orFail();
    const replacement = await invite(
      owner,
      wedding.id,
      "repeat-revoke@example.com",
    );

    await expect(
      revokeMemberInvitation(
        owner,
        wedding.id,
        original.record.id,
        original.record.version,
      ),
    ).resolves.toBeUndefined();
    expect(await MemberInvitation.findById(original.record.id).lean()).toEqual(
      revoked,
    );
    expect(
      (await MemberInvitation.findById(replacement.record.id))?.status,
    ).toBe("pending");
    await expect(
      exchangeMemberInvitation(replacement.token),
    ).resolves.toHaveProperty("context");
    await expect(
      revokeMemberInvitation(
        helper,
        wedding.id,
        original.record.id,
        original.record.version,
      ),
    ).rejects.toMatchObject({ status: 403 });

    const other = await actor("revoke-other@example.com");
    const otherWedding = await createWedding(other, {
      ...details,
      slug: "revoke-other-wedding",
    });
    await expect(
      revokeMemberInvitation(
        other,
        otherWedding.id,
        original.record.id,
        original.record.version,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  async function mailFixture(
    weddingId: string,
    invitationId: string,
    dispatchStarted = false,
    missingQuota = false,
  ) {
    const operation = await EmailOperation.create({
      scopeKey: `wedding:${weddingId}`,
      weddingId,
      kind: "memberInvitation",
      mode: "live",
      requestKey: String(new mongoose.Types.ObjectId()),
      requestHash: "fixture",
      status: "open",
      expectedJobs: 2,
    });
    if (!missingQuota)
      for (const [key, kind] of [
        ["day", "emailDay"],
        ["month", "emailMonth"],
      ] as const) {
        await Usage.create({
          _id: key,
          kind,
          windowStart: new Date(0),
          windowEnd: new Date("2099-01-01"),
          limit: 100,
          reserved: dispatchStarted ? 0 : 1,
          held: dispatchStarted ? 1 : 0,
        });
      }
    const job = await EmailJob.create({
      operationId: operation._id,
      scopeKey: operation.scopeKey,
      weddingId,
      subjectType: "memberInvitation",
      subjectId: invitationId,
      subjectKey: `memberInvitation:${invitationId}`,
      intendedRecipient: "fixture@example.com",
      actualRecipient: "fixture@example.com",
      kind: "memberInvitation",
      mode: "live",
      payloadCipher: sealPayload({ text: "isolated fixture" }, "fixture"),
      payloadHash: "fixture",
      idempotencyKey: String(new mongoose.Types.ObjectId()),
      state: dispatchStarted ? "needsReview" : "processing",
      quota: {
        dayId: "day",
        monthId: "month",
        state: dispatchStarted ? "held" : "reserved",
      },
      ...(dispatchStarted ? { dispatchStartedAt: new Date() } : {}),
    });
    return { job, operation };
  }
  it("cancels undispatched invitation jobs, releases only definite reservations and preserves unrelated recipients", async () => {
    const { owner, wedding } = await setup();
    const pending = await invite(owner, wedding.id, "queued@example.com");
    const { job, operation } = await mailFixture(wedding.id, pending.record.id);
    const other = await invite(owner, wedding.id, "unrelated@example.com");
    const neighbor = await EmailJob.create({
      ...job.toObject(),
      _id: new mongoose.Types.ObjectId(),
      subjectId: other.record.id,
      subjectKey: `memberInvitation:${other.record.id}`,
      idempotencyKey: "other-fixture",
      quota: undefined,
      state: "pending",
    });
    await revokeMemberInvitation(
      owner,
      wedding.id,
      pending.record.id,
      pending.record.version,
    );
    expect(await EmailJob.findById(job._id)).toMatchObject({
      state: "cancelled",
      quota: { state: "released" },
    });
    expect((await Usage.findById("day"))?.reserved).toBe(0);
    expect((await EmailJob.findById(neighbor._id))?.state).toBe("pending");
    expect((await EmailOperation.findById(operation._id))?.status).toBe("open");
  });
  it("retains ambiguous dispatch holds and rolls removal back if quota cleanup fails", async () => {
    const { owner, wedding, member } = await setup();
    const pending = await invite(owner, wedding.id, "held@example.com");
    const { job } = await mailFixture(wedding.id, pending.record.id, true);
    await revokeMemberInvitation(
      owner,
      wedding.id,
      pending.record.id,
      pending.record.version,
    );
    expect(await EmailJob.findById(job._id)).toMatchObject({
      state: "needsReview",
      quota: { state: "held" },
      cancelReason: "invitationRevoked",
    });
    expect((await Usage.findById("day"))?.held).toBe(1);
    await Usage.deleteMany({});
    const reentry = await invite(owner, wedding.id, "team-helper@example.com");
    await mailFixture(wedding.id, reentry.record.id, false, true);
    await expect(
      removeMember(owner, wedding.id, member.id, member.version),
    ).rejects.toThrow("Email quota accounting conflict");
    expect((await Membership.findById(member.id))?.status).toBe("active");
    expect((await MemberInvitation.findById(reentry.record.id))?.status).toBe(
      "pending",
    );
    await expect(
      exchangeMemberInvitation(reentry.token),
    ).resolves.toHaveProperty("context");
  });
  it("serializes competing role assignments and acceptance versus revocation", async () => {
    const { owner, wedding, helper, member } = await setup();
    const second = await actor("race-role@example.com");
    const secondMember = await Membership.create({
      weddingId: wedding.id,
      userId: second.id,
      role: "manager",
    });
    const roles = await Promise.allSettled([
      changeMemberRole(owner, wedding.id, member.id, {
        expectedVersion: member.version,
        role: "bride",
      }),
      changeMemberRole(owner, wedding.id, String(secondMember._id), {
        expectedVersion: 0,
        role: "bride",
      }),
    ]);
    expect(
      roles.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await Membership.countDocuments({
        weddingId: wedding.id,
        role: "bride",
        status: "active",
      }),
    ).toBe(1);
    const candidate = await actor("race-invite@example.com");
    const pending = await invite(owner, wedding.id, "race-invite@example.com");
    const outcomes = await Promise.allSettled([
      acceptMemberInvitation(candidate, pending.grant),
      revokeMemberInvitation(
        owner,
        wedding.id,
        pending.record.id,
        pending.record.version,
      ),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const record = await MemberInvitation.findById(pending.record.id).orFail();
    expect(
      await Membership.countDocuments({
        userId: candidate.id,
        status: "active",
      }),
    ).toBe(record.status === "accepted" ? 1 : 0);
    // A manager may never perform administration after another actor changes their access.
    if ((await getMember(owner, wedding.id, member.id)).role === "bride") {
      const latest = await getMember(owner, wedding.id, member.id);
      await changeMemberRole(owner, wedding.id, member.id, {
        expectedVersion: latest.version,
        role: "manager",
      });
    }
    await expect(
      createMemberInvitation(helper, wedding.id, {
        email: "after-demotion@example.com",
        role: "manager",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
