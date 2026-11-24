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
) {
  const headers = new Headers({
    origin,
    cookie: Array.from(cookies, ([key, value]) => `${key}=${value}`).join("; "),
  });
  if (auth) headers.set("X-Auth-Return-Redirect", "1");
  let encoded: string | URLSearchParams | undefined;
  if (body instanceof URLSearchParams) encoded = body;
  else if (body) {
    const csrf = await request("/api/v1/csrf");
    headers.set(
      "cookie",
      Array.from(cookies, ([key, value]) => `${key}=${value}`).join("; "),
    );
    headers.set("X-CSRF-Token", (await csrf.json()).data.csrfToken);
    headers.set("content-type", "application/json");
    encoded = JSON.stringify(body);
  }
  const result = await fetch(`${origin}${path}`, {
    method: body ? "POST" : "GET",
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
