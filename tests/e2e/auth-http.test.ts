import { Wedding } from "@/modules/weddings/models";
import { WeddingEvent } from "@/modules/events/model";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import { RateLimit } from "@/lib/security/rate-limit";
import { connectDatabase } from "@/lib/db/connection";
import { AuthToken, User } from "@/modules/identity/models";
import { EmailJob } from "@/modules/email/models";
import { openPayload } from "@/lib/security/crypto";
import type { IdentityEmailPayload } from "@/lib/providers/resend";
import { hashPassword } from "@/modules/identity/passwords";

let database: MongoMemoryReplSet;
let server: ChildProcess;
let origin: string;
const cookies = new Map<string, string>();
const email = "http-test@example.com";
const password = "an isolated test password";
async function request(
  path: string,
  body?: URLSearchParams | object,
  auth = false,
  method?: "PATCH" | "DELETE",
) {
  const headers = new Headers({
    origin,
    cookie: Array.from(cookies, ([key, value]) => `${key}=${value}`).join("; "),
  });
  if (auth) headers.set("X-Auth-Return-Redirect", "1");
  let encoded: string | URLSearchParams | undefined;
  if (body instanceof URLSearchParams) encoded = body;
  else if (body || method === "DELETE") {
    const csrf = await request("/api/v1/csrf");
    headers.set(
      "cookie",
      Array.from(cookies, ([key, value]) => `${key}=${value}`).join("; "),
    );
    headers.set("X-CSRF-Token", (await csrf.json()).data.csrfToken);
    if (body) {
      headers.set("content-type", "application/json");
      encoded = JSON.stringify(body);
    }
  }
  const result = await fetch(`${origin}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers,
    body: encoded,
    redirect: "manual",
  });
  for (const cookie of result.headers.getSetCookie()) {
    const pair = cookie.split(";")[0];
    const at = pair.indexOf("=");
    cookies.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return result;
}
async function login(value: string, address = email) {
  const csrf = await (await request("/api/auth/csrf")).json();
  return request(
    "/api/auth/callback/credentials",
    new URLSearchParams({
      email: address,
      password: value,
      csrfToken: csrf.csrfToken,
      callbackUrl: `${origin}/onboarding`,
    }),
    true,
  );
}
beforeAll(async () => {
  const listener = createServer();
  await new Promise<void>((resolve) =>
    listener.listen(0, "127.0.0.1", resolve),
  );
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  origin = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  database = await MongoMemoryReplSet.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? {
          systemBinary: process.env.MONGOMS_SYSTEM_BINARY,
          version: process.env.MONGOMS_VERSION ?? "6.0.10",
        }
      : undefined,
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  Object.assign(process.env, {
    MONGODB_URI: database.getUri(),
    MONGODB_DB_NAME: "http_isolated_test",
    AUTH_SECRET: randomBytes(32).toString("base64"),
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    TOKEN_ENCRYPTION_KEY_ID: "http-test-key",
    APP_ORIGIN: origin,
    AUTH_URL: origin,
    EMAIL_MODE: "simulated",
    // Production must still enforce real verification with this flag present.
    DEV_SKIP_EMAIL_VERIFICATION: "true",
  });
  // Exercise the documented migration command as well as the running app.
  const migration = await promisify(execFile)(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/migrations/001-identity.ts",
    ],
    { env: process.env },
  );
  expect(migration.stdout).toContain("Identity migration 001 applied");
  const weddingMigration = await promisify(execFile)(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/migrations/002-weddings.ts",
    ],
    { env: process.env },
  );
  expect(weddingMigration.stdout).toContain("Wedding migration 002 applied");

  await promisify(execFile)(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/migrations/003-events.ts",
    ],
    { env: process.env },
  );
  await promisify(execFile)(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/migrations/004-guests.ts",
    ],
    { env: process.env },
  );
  await connectDatabase();
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(address.port),
    ],
    {
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_ENV: "production",
      },
      stdio: "ignore",
    },
  );
  const deadline = Date.now() + 30000;
  while (true) {
    try {
      if ((await fetch(`${origin}/login`)).ok) break;
    } catch {}
    if (Date.now() > deadline)
      throw new Error("Production test server did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});
afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await stopped;
  }
  await mongoose.disconnect();
  await database?.stop();
});
it("serves registration, credentials/JWT login, private account, reset revocation and logout over HTTP", async () => {
  const publicHome = await request("/");
  expect(publicHome.status).toBe(200);
  expect(publicHome.headers.get("cache-control")).toContain("no-store");
  const publicHtml = await publicHome.text();
  expect(publicHtml).toContain("Create your wedding");
  expect(publicHtml).toContain('href="/login"');
  expect((await request("/onboarding")).status).toBe(307);
  expect((await request("/api/v1/me")).status).toBe(401);
  const registered = await request("/api/v1/identity/register", {
    name: "HTTP tester",
    email,
    password,
  });
  expect(registered.status).toBe(202);
  expect(await registered.text()).not.toMatch(
    /passwordHash|tokenHash|operationId/,
  );
  const job = await EmailJob.findOne({ kind: "verifyEmail" })
    .select("+payloadCipher")
    .orFail();
  const payload = openPayload<IdentityEmailPayload>(
    job.payloadCipher!,
    `email:${job._id}`,
  );
  const verifyToken = new URL(
    payload.text.match(/https?:\/\/[^\s]+/)![0],
  ).hash.slice(7);
  expect((await request("/verify-email")).status).toBe(200);
  expect((await User.findOne())?.emailVerifiedAt).toBeUndefined();
  expect((await AuthToken.findOne())?.consumedAt).toBeUndefined();
  expect(
    (await request("/api/v1/identity/verify-email", { token: verifyToken }))
      .status,
  ).toBe(200);
  const rejected = await (await login("wrong password")).json();
  expect(new URL(rejected.url).searchParams.get("error")).toBe(
    "CredentialsSignin",
  );
  const signedIn = await (await login(password)).json();
  expect(signedIn.url).toBe(`${origin}/onboarding`);
  expect(Array.from(cookies.keys())).toContain("authjs.session-token");
  expect((await request("/onboarding")).status).toBe(200);
  const me = await (await request("/api/v1/me")).json();
  expect(me.data).toMatchObject({
    email,
    emailVerified: true,
    membership: null,
  });
  expect(JSON.stringify(me)).not.toMatch(/passwordHash|sessionVersion|token/);
  const accountHome = await request("/");
  expect(accountHome.status).toBe(200);
  expect(accountHome.headers.get("cache-control")).toContain("private");
  const accountHtml = await accountHome.text();
  expect(accountHtml).toContain(email);
  expect(accountHtml).toContain("Continue setup");
  expect(accountHtml).toContain("Log out");
  expect(accountHtml).not.toContain('href="/login"');
  expect(accountHtml).not.toContain('href="/register"');
  const oldCookie = cookies.get("authjs.session-token")!;
  expect(
    (await request("/api/v1/identity/forgot-password", { email })).status,
  ).toBe(202);
  const resetJob = await EmailJob.findOne({ kind: "resetPassword" })
    .select("+payloadCipher")
    .orFail();
  const resetPayload = openPayload<IdentityEmailPayload>(
    resetJob.payloadCipher!,
    `email:${resetJob._id}`,
  );
  const resetToken = new URL(
    resetPayload.text.match(/https?:\/\/[^\s]+/)![0],
  ).hash.slice(7);
  expect(
    (
      await request("/api/v1/identity/reset-password", {
        token: resetToken,
        newPassword: "a different long password",
      })
    ).status,
  ).toBe(200);
  cookies.set("authjs.session-token", oldCookie);
  expect((await request("/api/v1/me")).status).toBe(401);
  const revokedSessionHome = await (await request("/")).text();
  expect(revokedSessionHome).not.toContain(email);
  expect(revokedSessionHome).toContain('href="/login"');
  expect((await request("/onboarding")).status).toBe(307);
  expect((await (await login("a different long password")).json()).url).toBe(
    `${origin}/onboarding`,
  );
  const csrf = await (await request("/api/auth/csrf")).json();
  const signedOut = await request(
    "/api/auth/signout",
    new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl: "/" }),
    true,
  );
  expect((await signedOut.json()).url).toBe(origin);
  expect((await request("/api/v1/me")).status).toBe(401);
  const signedOutHome = await (await request("/")).text();
  expect(signedOutHome).not.toContain(email);
  expect(signedOutHome).toContain('href="/login"');
});

async function logout() {
  const bootstrap = await request("/api/auth/csrf");
  expect(bootstrap.status).toBe(200);
  const csrf = await bootstrap.json();
  const response = await request(
    "/api/auth/signout",
    new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl: "/" }),
    true,
  );
  expect(response.status).toBe(200);
  expect(
    response.headers
      .getSetCookie()
      .some(
        (cookie) =>
          cookie.startsWith("authjs.session-token=;") &&
          /Max-Age=0/.test(cookie),
      ),
  ).toBe(true);
  expect((await response.json()).url).toBe(origin);
}
it("clears the session even when the credential IP limiter is exhausted", async () => {
  expect((await (await login("a different long password")).json()).url).toBe(
    `${origin}/onboarding`,
  );
  const scopeKey = createHmac("sha256", process.env.AUTH_SECRET!)
    .update("auth-network:local")
    .digest("hex");
  await RateLimit.updateMany({ scopeKey }, { $set: { count: 1000 } });
  try {
    await logout();
    expect((await request("/api/v1/me")).status).toBe(401);
  } finally {
    await RateLimit.deleteMany({ scopeKey });
  }
});
it("clears the session during a database outage and stays logged out after recovery", async () => {
  expect((await (await login("a different long password")).json()).url).toBe(
    `${origin}/onboarding`,
  );
  await mongoose.disconnect();
  const mongod = database.servers[0];
  await mongod.stop({ doCleanup: false });
  try {
    const crossSite = await fetch(`${origin}/api/auth/signout`, {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "csrfToken=invalid",
    });
    expect(crossSite.status).toBe(403);
    await logout();
  } finally {
    await mongod.start(true);
    await connectDatabase();
  }
  expect((await request("/api/v1/me")).status).toBe(401);
}, 60000);

it("creates a wedding and preserves private invitation context through registration, verification and explicit acceptance", async () => {
  expect((await (await login("a different long password")).json()).url).toBe(
    `${origin}/onboarding`,
  );
  const page = await request("/onboarding");
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("Review wedding");
  const body = {
    couple: { brideName: "Ananya Sharma", groomName: "Aarav Mehta" },
    weddingDate: "2027-02-21",
    location: "Jaipur, Rajasthan",
    slug: "ananya-aarav",
    creatorRole: "manager",
  };
  const result = await request("/api/v1/weddings", body);
  expect(result.status).toBe(201);
  const wedding = (await result.json()).data;
  expect(result.headers.get("location")).toBe(`/api/v1/weddings/${wedding.id}`);
  const existing = await request("/onboarding");
  expect(existing.status).toBe(307);
  expect(existing.headers.get("location")).toBe(`/dashboard/${wedding.id}`);
  expect((await request(`/dashboard/${wedding.id}`)).status).toBe(200);
  const ownerHome = await request("/");
  expect(ownerHome.headers.get("cache-control")).toContain("no-store");
  const ownerHtml = await ownerHome.text();
  expect(ownerHtml).toContain(email);
  expect(ownerHtml).toContain("My wedding");
  expect(ownerHtml).toContain(`href="/dashboard/${wedding.id}"`);
  expect(ownerHtml).not.toContain('href="/register"');
  expect(ownerHtml).not.toContain('href="/login"');
  const guestHome = await fetch(`${origin}/`);
  const guestHtml = await guestHome.text();
  expect(guestHtml).not.toContain(email);
  expect(guestHtml).not.toContain(wedding.id);
  expect(guestHtml).toContain('href="/register"');
  const invitee = "invited-http@example.com";
  const createdInvite = await request(
    `/api/v1/weddings/${wedding.id}/member-invitations`,
    { email: invitee, role: "manager" },
  );
  expect(createdInvite.status).toBe(201);
  const invitation = (await createdInvite.json()).data;
  expect(
    (
      await request(
        `/api/v1/weddings/${wedding.id}/member-invitations/${invitation.id}`,
      )
    ).status,
  ).toBe(200);
  const shared = await request(
    `/api/v1/weddings/${wedding.id}/member-invitations/${invitation.id}/share-link`,
    {},
  );
  expect(shared.status).toBe(200);
  const link = new URL((await shared.json()).data.url);
  const token = new URLSearchParams(link.hash.slice(1)).get("token")!;
  await logout();
  const exchanged = await request("/api/v1/access/member-invitation", {
    token,
  });
  expect(exchanged.status).toBe(200);
  const context = (await exchanged.json()).data;
  expect(JSON.stringify(context)).not.toContain(invitee);
  const anonymous = await request(context.cleanPath);
  expect(anonymous.status).toBe(200);
  const anonymousHtml = await anonymous.text();
  expect(anonymousHtml).toContain("Log in to continue");
  expect(anonymousHtml).not.toContain(invitee);
  expect(
    await mongoose.connection.db!.collection("memberships").countDocuments(),
  ).toBe(1);
  const registered = await request("/api/v1/identity/register", {
    name: "Invited helper",
    email: invitee,
    password: "another isolated long password",
  });
  expect(registered.status).toBe(202);
  expect(
    (await (await login("another isolated long password", invitee)).json()).url,
  ).toBe(`${origin}/onboarding`);
  const gate = await request("/onboarding");
  expect(gate.status).toBe(200);
  expect(await gate.text()).toContain("Verify your email");
  const verificationJob = await EmailJob.findOne({
    intendedRecipient: invitee,
    kind: "verifyEmail",
  })
    .select("+payloadCipher")
    .orFail();
  const verificationPayload = openPayload<IdentityEmailPayload>(
    verificationJob.payloadCipher!,
    `email:${verificationJob._id}`,
  );
  const verificationToken = new URL(
    verificationPayload.text.match(/https?:\/\/[^\s]+/)![0],
  ).hash.slice(7);
  expect(
    (
      await request("/api/v1/identity/verify-email", {
        token: verificationToken,
      })
    ).status,
  ).toBe(200);
  const returned = await request("/onboarding");
  expect(returned.status).toBe(307);
  expect(returned.headers.get("location")).toBe(context.cleanPath);
  const eligible = await request(context.cleanPath);
  expect(await eligible.text()).toContain("Accept invitation");
  const postponed = await request("/onboarding?skipInvitation=1");
  expect(postponed.status).toBe(200);
  expect(await postponed.text()).toContain("Review wedding");
  expect(
    await mongoose.connection.db!.collection("memberships").countDocuments(),
  ).toBe(1);
  const accepted = await request(
    `/api/v1/member-invitations/${invitation.id}/accept`,
    {},
  );
  expect(accepted.status).toBe(200);
  const member = (await accepted.json()).data;
  expect(member).toMatchObject({ role: "manager", isOwner: false });
  const repeated = await request(
    `/api/v1/member-invitations/${invitation.id}/accept`,
    {},
  );
  expect(repeated.status).toBe(200);
  expect((await repeated.json()).data.id).toBe(member.id);
  const me = await request("/api/v1/me");
  expect((await me.json()).data.membership).toMatchObject({
    weddingId: wedding.id,
    role: "manager",
    isOwner: false,
  });
  const helperHome = await (await request("/")).text();
  expect(helperHome).toContain(invitee);
  expect(helperHome).toContain(`href="/dashboard/${wedding.id}"`);
  expect(helperHome).not.toContain('href="/register"');
  const denied = await request(
    `/api/v1/weddings/${wedding.id}/member-invitations`,
    { email: "not-allowed@example.com", role: "groom" },
  );
  expect(denied.status).toBe(403);
  expect(
    (await request("/api/v1/weddings", { ...body, slug: "second-wedding" }))
      .status,
  ).toBe(409);
  expect(
    (await request("/api/v1/access/member-invitation", { token })).status,
  ).toBe(404);
  await mongoose.connection.db!.collection("memberships").updateOne(
    { userId: new mongoose.Types.ObjectId(member.userId), status: "active" },
    {
      $set: { status: "revoked", revokedAt: new Date() },
      $inc: { version: 1 },
    },
  );
  const formerMemberHome = await (await request("/")).text();
  expect(formerMemberHome).toContain(invitee);
  expect(formerMemberHome).toContain("Continue setup");
  expect(formerMemberHome).not.toContain(`href="/dashboard/${wedding.id}"`);
});

it("manages the planning team through scoped, paginated and versioned APIs with owner protection and immediate revocation", async () => {
  await logout();
  await login("a different long password");
  const owner = (await (await request("/api/v1/me")).json()).data;
  const weddingId = owner.membership.weddingId;
  const base = `/api/v1/weddings/${weddingId}`;
  expect((await request(`/dashboard/${weddingId}/team`)).status).toBe(200);
  const roster = await (await request(`${base}/members`)).json();
  expect(roster.page).toMatchObject({
    limit: 25,
    nextCursor: null,
    hasMore: false,
  });
  expect(JSON.stringify(roster)).not.toMatch(
    /email|password|sessionVersion|token/,
  );
  const ownerMember = roster.data.find(
    (item: { isOwner: boolean }) => item.isOwner,
  );
  expect(
    (
      await request(
        `${base}/members/${ownerMember.id}`,
        { expectedVersion: ownerMember.version, role: "bride" },
        false,
        "PATCH",
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await request(
        `${base}/members/${ownerMember.id}?expectedVersion=${ownerMember.version}`,
        undefined,
        false,
        "DELETE",
      )
    ).status,
  ).toBe(409);
  expect((await request(`${base}/members?limit=101`)).status).toBe(422);
  expect(
    (await request(`${base}/members?status=active&status=revoked`)).status,
  ).toBe(422);
  const helperEmail = "team-admin-http@example.com";
  await User.create({
    name: "Planning helper",
    emailNormalized: helperEmail,
    passwordHash: await hashPassword("planning helper password"),
    emailVerifiedAt: new Date(),
  });
  const created = await request(`${base}/member-invitations`, {
    email: helperEmail,
    role: "manager",
  });
  expect(created.status).toBe(201);
  const invitation = (await created.json()).data;
  const link = (
    await (
      await request(
        `${base}/member-invitations/${invitation.id}/share-link`,
        {},
      )
    ).json()
  ).data.url;
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
  const hiddenEmail = "private-pending-http@example.com";
  const pending = (
    await (
      await request(`${base}/member-invitations`, {
        email: hiddenEmail,
        role: "manager",
      })
    ).json()
  ).data;
  const privatePage = await (
    await request(`${base}/member-invitations?limit=1`)
  ).json();
  expect(privatePage).toMatchObject({
    data: expect.any(Array),
    page: { limit: 1, hasMore: true },
  });
  const nextPage = await request(
    `${base}/member-invitations?limit=1&cursor=${encodeURIComponent(privatePage.page.nextCursor)}`,
  );
  expect(nextPage.status).toBe(200);
  expect(
    (
      await request(
        `${base}/members?limit=1&cursor=${encodeURIComponent(privatePage.page.nextCursor)}`,
      )
    ).status,
  ).toBe(400);
  expect(
    (await request(`${base}/member-invitations?cursor=tampered`)).status,
  ).toBe(400);
  expect(
    (await request(`/api/v1/access/member-invitation`, { token })).status,
  ).toBe(200);
  await logout();
  await login("planning helper password", helperEmail);
  const joined = await request(
    `/api/v1/member-invitations/${invitation.id}/accept`,
    {},
  );
  expect(joined.status).toBe(200);
  const member = (await joined.json()).data;
  const currentWedding = (await (await request(base)).json()).data;
  const expectedVersion = currentWedding.version;
  expect(
    (await request(base, { expectedVersion, slug: "changed" }, false, "PATCH"))
      .status,
  ).toBe(422);
  expect(
    (
      await request(
        base,
        {
          expectedVersion,
          youtubeUrl: "https://example.com/watch?v=abcdefghijk",
        },
        false,
        "PATCH",
      )
    ).status,
  ).toBe(422);
  const edited = await request(
    base,
    {
      expectedVersion,
      location: "Updated garden venue",
      youtubeUrl: "https://youtu.be/abcdefghijk",
    },
    false,
    "PATCH",
  );
  expect(edited.status).toBe(200);
  expect((await edited.json()).data).toMatchObject({
    location: "Updated garden venue",
    youtubeVideoId: "abcdefghijk",
    version: expectedVersion + 1,
    slug: currentWedding.slug,
    couple: currentWedding.couple,
  });
  const stale = await request(
    base,
    { expectedVersion, location: "Stale venue" },
    false,
    "PATCH",
  );
  expect(stale.status).toBe(409);
  expect((await stale.json()).error.code).toBe("VERSION_CONFLICT");
  const dashboard = await (await request(`/dashboard/${weddingId}`)).text();
  expect(dashboard).toContain("Updated garden venue");
  expect(dashboard).toContain("Edit wedding details");
  expect(dashboard).toContain("https://www.youtube.com/watch?v=abcdefghijk");
  const cleared = await request(
    base,
    { expectedVersion: expectedVersion + 1, youtubeUrl: null },
    false,
    "PATCH",
  );
  expect(cleared.status).toBe(200);
  expect((await cleared.json()).data.youtubeVideoId).toBeUndefined();
  await verifyGuestWorkflow(base, weddingId);
  const helperPage = await request(`/dashboard/${weddingId}/team`);
  expect(helperPage.status).toBe(200);
  const helperHtml = await helperPage.text();
  expect(helperHtml).toContain("Read-only roster");
  expect(helperHtml).not.toContain(hiddenEmail);
  expect(helperHtml).not.toContain("Pending invitations");
  expect(helperHtml).not.toContain("Invite a member");
  expect((await request(`${base}/member-invitations`)).status).toBe(403);
  expect((await request(`${base}/members?status=revoked`)).status).toBe(403);
  expect(
    (
      await request(
        `${base}/members/${member.id}`,
        { role: "bride", expectedVersion: member.version },
        false,
        "PATCH",
      )
    ).status,
  ).toBe(403);
  await logout();
  await login("a different long password");
  const before = (await (await request(`${base}/members/${member.id}`)).json())
    .data;
  const noCsrf = await fetch(`${origin}${base}/members/${member.id}`, {
    method: "PATCH",
    headers: {
      origin,
      cookie: Array.from(cookies, ([k, v]) => `${k}=${v}`).join("; "),
      "content-type": "application/json",
    },
    body: JSON.stringify({ role: "bride", expectedVersion: before.version }),
  });
  expect(noCsrf.status).toBe(403);
  const promoted = await request(
    `${base}/members/${member.id}`,
    { role: "bride", expectedVersion: before.version },
    false,
    "PATCH",
  );
  expect(promoted.status).toBe(200);
  const bride = (await promoted.json()).data;
  expect(bride.role).toBe("bride");
  expect(
    (
      await request(
        `${base}/members/${member.id}`,
        { role: "manager", expectedVersion: before.version },
        false,
        "PATCH",
      )
    ).status,
  ).toBe(409);
  await logout();
  await login("planning helper password", helperEmail);
  expect((await request(`${base}/member-invitations`)).status).toBe(200);
  const demoted = await request(
    `${base}/members/${member.id}`,
    { role: "manager", expectedVersion: bride.version },
    false,
    "PATCH",
  );
  expect(demoted.status).toBe(200);
  expect((await request(`${base}/member-invitations`)).status).toBe(403);
  await logout();
  await login("a different long password");
  expect(
    (
      await request(
        `${base}/member-invitations/${pending.id}?expectedVersion=${pending.version}`,
        undefined,
        false,
        "DELETE",
      )
    ).status,
  ).toBe(204);
  const repeatedRevocation = await request(
    `${base}/member-invitations/${pending.id}?expectedVersion=${pending.version}`,
    undefined,
    false,
    "DELETE",
  );
  expect(repeatedRevocation.status).toBe(204);
  expect(await repeatedRevocation.text()).toBe("");
  expect((await request(`${base}/member-invitations`)).status).toBe(200);
  const latest = (await (await request(`${base}/members/${member.id}`)).json())
    .data;
  const removed = await request(
    `${base}/members/${member.id}?expectedVersion=${latest.version}`,
    undefined,
    false,
    "DELETE",
  );
  expect(removed.status).toBe(204);
  expect(await removed.text()).toBe("");
  const repeatedRemoval = await request(
    `${base}/members/${member.id}?expectedVersion=${latest.version}`,
    undefined,
    false,
    "DELETE",
  );
  expect(repeatedRemoval.status).toBe(204);
  expect(await repeatedRemoval.text()).toBe("");
  const history = (
    await (await request(`${base}/members?status=revoked`)).json()
  ).data;
  expect(history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: member.id,
        status: "revoked",
        revokedBy: owner.id,
      }),
    ]),
  );
  await logout();
  await login("planning helper password", helperEmail);
  expect((await request(`${base}/members`)).status).toBe(404);
  expect((await request(`/dashboard/${weddingId}/team`)).status).toBe(404);
  expect(
    (await (await request("/api/v1/me")).json()).data.membership,
  ).toBeNull();
});

it("maintains a wedding schedule with IST times, cursor ordering, stale-write checks and scoped deletion", async () => {
  await logout();
  await login("a different long password");
  const me = (await (await request("/api/v1/me")).json()).data;
  const path = "/dashboard/" + me.membership.weddingId + "/events";
  const api = "/api/v1/weddings/" + me.membership.weddingId + "/events";
  expect(await (await request(path)).text()).toContain("Add your first event");
  const values = {
    name: "Sangeet",
    location: "Garden",
    startsAt: "2027-02-12T23:30:00+05:30",
    endsAt: "2027-02-13T01:00:00+05:30",
    description: "Music",
  };
  const created = await request(api, values);
  expect(created.status).toBe(201);
  const event = (await created.json()).data,
    detail = api + "/" + event.id;
  expect(event.startsAt).toBe("2027-02-12T18:00:00.000Z");
  const earlier = (
    await (
      await request(api, {
        ...values,
        name: "Mehendi",
        startsAt: "2027-02-11T10:00:00+05:30",
      })
    ).json()
  ).data;
  const first = await (await request(api + "?limit=1")).json();
  expect(first.data[0].id).toBe(earlier.id);
  const next = await (
    await request(
      api + "?limit=1&cursor=" + encodeURIComponent(first.page.nextCursor),
    )
  ).json();
  expect(next.data[0].id).toBe(event.id);
  expect(
    (
      await request(
        detail,
        { startsAt: "2027-02-15T00:00:00Z", expectedVersion: event.version },
        false,
        "PATCH",
      )
    ).status,
  ).toBe(422);
  const edited = await request(
    detail,
    { expectedVersion: event.version, location: "Amber Hall", endsAt: null },
    false,
    "PATCH",
  );
  expect(edited.status).toBe(200);
  const saved = (await edited.json()).data;
  expect(saved.endsAt).toBeUndefined();
  expect(
    (
      await request(
        detail,
        { expectedVersion: event.version, name: "Outdated" },
        false,
        "PATCH",
      )
    ).status,
  ).toBe(409);
  expect(await (await request(path)).text()).toContain("Amber Hall");
  const invitations = mongoose.connection.db!.collection("eventInvitations");
  const { insertedId } = await invitations.insertOne({
    guestId: new mongoose.Types.ObjectId(),
    createdBy: new mongoose.Types.ObjectId(me.id),
    guestContactRevision: 0,
    schemaVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    token: {
      hash: "isolated-fixture",
      version: 0,
      ciphertext: "fixture",
      keyId: "fixture",
      nonce: "fixture",
      tag: "fixture",
      issuedAt: new Date(),
    },
    eventId: new mongoose.Types.ObjectId(event.id),
    weddingId: new mongoose.Types.ObjectId(me.membership.weddingId),
    status: "active",
    rsvp: "attending",
    version: 0,
  });
  expect(
    (
      await request(
        detail + "?expectedVersion=" + event.version,
        undefined,
        false,
        "DELETE",
      )
    ).status,
  ).toBe(409);
  for (let i = 0; i < 2; i++) {
    expect(
      (
        await request(
          detail + "?expectedVersion=" + saved.version,
          undefined,
          false,
          "DELETE",
        )
      ).status,
    ).toBe(204);
  }
  expect(await invitations.findOne({ _id: insertedId })).toMatchObject({
    rsvp: "attending",
    status: "revoked",
    revokedReason: "eventDeleted",
    version: 1,
  });
  expect((await request(detail)).status).toBe(404);
  expect(
    (await (await request(api)).json()).data.map(
      (item: { id: string }) => item.id,
    ),
  ).toEqual([earlier.id]);
  await logout();
  await login("planning helper password", "team-admin-http@example.com");
  expect((await request(api)).status).toBe(404);
  expect((await request(api, values)).status).toBe(404);
});

it("serves the celebration anonymously with public-only fields, fresh event pages and an optional stream", async () => {
  const owner = new mongoose.Types.ObjectId();
  const wedding = await Wedding.create({
    ownerUserId: owner,
    slug: "public-fixture",
    couple: { brideName: "Ananya", groomName: "Aarav" },
    weddingDate: "2027-02-13",
    location: "Jaipur",
  });
  const empty = await fetch(origin + "/weddings/" + wedding.slug);
  expect(await empty.text()).toContain(
    "The wedding schedule hasn’t been added yet.",
  );
  const details = {
    weddingId: wedding._id,
    createdBy: owner,
    updatedBy: owner,
    startsAt: new Date("2027-02-12T07:00:00Z"),
    location: "Garden",
  };
  await WeddingEvent.create([
    {
      ...details,
      name: "Mehendi",
      endsAt: new Date("2027-02-12T09:00:00Z"),
      description: "Together in the garden.",
    },
    { ...details, name: "Sangeet", isDeleted: true },
    {
      ...details,
      weddingId: new mongoose.Types.ObjectId(),
      name: "Other wedding only",
    },
  ]);
  const page = "/weddings/" + wedding.slug,
    api = "/api/v1/public" + page;
  // Public requests deliberately have no cookies, including after member edits.
  const visit = (path: string) => fetch(origin + path, { redirect: "manual" });
  const first = await visit(api);
  expect(first.status).toBe(200);
  expect(first.headers.get("cache-control")).toContain("no-store");
  const publicData = (await first.json()).data;
  expect(publicData).toEqual({
    slug: wedding.slug,
    couple: wedding.couple,
    location: wedding.location,
    weddingDate: wedding.weddingDate,
    timezone: "Asia/Kolkata",
    eventsUrl: api + "/events",
  });
  const html = await (await visit(page)).text();
  expect(html).toContain("Mehendi");
  expect(html).not.toContain("Sangeet");
  expect(html).not.toContain("Open on YouTube");
  expect(html).not.toContain(String(owner));
  expect(html).not.toContain("Other wedding only");
  expect(html).not.toContain(String(wedding._id));
  await Wedding.updateOne(
    { _id: wedding._id },
    {
      $set: {
        introduction: "Welcome to our celebration!",
        youtubeVideoId: "abcdefghijk",
      },
    },
  );
  const live = await (await visit(page)).text();
  expect(live).toContain("Welcome to our celebration!");
  expect(live).toContain("https://www.youtube-nocookie.com/embed/abcdefghijk");
  expect(live).toContain("https://www.youtube.com/watch?v=abcdefghijk");
  const add = await WeddingEvent.create({
    ...details,
    name: "Morning ceremony",
    location: "Courtyard",
    startsAt: "2027-02-13T08:00:00+05:30",
  });

  const eventPage = await (await visit(api + "/events?limit=1")).json();
  expect(Object.keys(eventPage.data[0]).sort()).toEqual(
    ["id", "name", "location", "startsAt", "endsAt", "description"].sort(),
  );
  expect(eventPage.data[0].name).toBe("Mehendi");
  const cursor = encodeURIComponent(eventPage.page.nextCursor);
  const second = await (
    await visit(api + "/events?limit=1&cursor=" + cursor)
  ).json();
  expect(second.data).toEqual([
    {
      id: String(add._id),
      name: "Morning ceremony",
      location: "Courtyard",
      startsAt: "2027-02-13T02:30:00.000Z",
    },
  ]);
  expect((await visit(api + "/events?limit=2&cursor=" + cursor)).status).toBe(
    400,
  );
  expect((await visit(api + "/events?includeDeleted=true")).status).toBe(422);
  const missing = await visit("/weddings/no-such-celebration");
  expect(missing.status).toBe(404);
  expect(await missing.text()).toContain("Wedding page unavailable");
  expect(
    (await visit("/api/v1/public/weddings/no-such-celebration/events")).status,
  ).toBe(404);
});

async function verifyGuestWorkflow(base: string, weddingId: string) {
  const root = base + "/guests",
    selections = base + "/event-invitations";
  const create = await request(root, { name: "Riya Shah" });
  expect(create.status).toBe(201);
  const person = (await create.json()).data;
  const page = "/dashboard/" + weddingId + "/guests";
  expect(await (await request(page)).text()).toContain("Riya Shah");
  const fn = (
    await (
      await request(base + "/events", {
        name: "Guest workflow fixture",
        location: "Garden",
        startsAt: "2027-02-10T12:00:00Z",
      })
    ).json()
  ).data;
  const choice = { guestId: person.id, eventId: fn.id };
  const add = await request(selections, choice);
  expect(add.status).toBe(201);
  const i = (await add.json()).data;
  expect(i.rsvp).toBe("pending");
  expect(i.token).toBeUndefined();
  expect((await request(selections, choice)).status).toBe(409);
  const ip = selections + "/" + i.id,
    gp = root + "/" + person.id;
  const active = await (await request(gp)).json();
  const db = mongoose.connection.db!.collection("eventInvitations"),
    key = { _id: new mongoose.Types.ObjectId(i.id) };
  const old = await db.findOne(key);
  await db.updateOne(key, { $set: { rsvp: "attending" } });
  const patch = await request(
    gp,
    { email: "Riya@Example.com", expectedVersion: active.data.version },
    false,
    "PATCH",
  );
  expect(patch.status).toBe(200);
  const updated = await patch.json();
  expect(updated.data.email).toBe("riya@example.com");
  expect(updated.effects.rsvpsPreserved).toBe(true);
  const rotated = await db.findOne(key);
  expect(rotated!.token.hash).not.toBe(old!.token.hash);
  expect(
    (await request(root, { name: "Other", email: "RIYA@example.com" })).status,
  ).toBe(409);
  expect(
    (
      await request(
        gp,
        { name: "Stale", expectedVersion: active.data.version },
        false,
        "PATCH",
      )
    ).status,
  ).toBe(409);
  expect(
    await (
      await request(page + "?view=events&event=" + fn.id + "&rsvp=attending")
    ).text(),
  ).toContain("Riya Shah");
  expect(
    await (await request(page + "?view=events&event=" + fn.id)).text(),
  ).toContain("View Riya Shah");
  expect(
    await (
      await request(page + "?view=events&event=" + fn.id + "&q=NoMatch")
    ).text(),
  ).toContain("No guests match these filters.");
  expect(await (await request(page + "?guest=" + person.id)).text()).toContain(
    "Remove from event",
  );
  expect(
    (
      await request(
        ip + "?expectedVersion=" + rotated!.version,
        undefined,
        false,
        "DELETE",
      )
    ).status,
  ).toBe(204);
  const revoked = (await (await request(ip)).json()).data;
  const back = await request(ip + "/reactivate", {
    expectedVersion: revoked.version,
  });
  expect((await back.json()).data.rsvp).toBe("attending");
  const latest = (await (await request(gp)).json()).data;
  expect(
    (
      await request(
        gp + "?expectedVersion=" + latest.version,
        undefined,
        false,
        "DELETE",
      )
    ).status,
  ).toBe(204);
  expect((await request(gp)).status).toBe(404);
  expect(await db.findOne(key)).toMatchObject({
    status: "revoked",
    revokedReason: "guestDeleted",
    rsvp: "attending",
  });
  const event = (await (await request(base + "/events/" + fn.id)).json()).data;
  await request(
    base + "/events/" + fn.id + "?expectedVersion=" + event.version,
    undefined,
    false,
    "DELETE",
  );
}
