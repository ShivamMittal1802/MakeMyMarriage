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
async function login(value: string) {
  const csrf = await (await request("/api/auth/csrf")).json();
  return request(
    "/api/auth/callback/credentials",
    new URLSearchParams({
      email,
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
