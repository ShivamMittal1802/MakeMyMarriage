import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import { ensureIdentityDatabase } from "@/lib/db/readiness";
import { connectDatabase } from "@/lib/db/connection";
import { migrateIdentity } from "@/lib/db/migrate-identity";
import { registrationSchema, resetSchema } from "@/modules/identity/schemas";
import { User, AuthToken } from "@/modules/identity/models";
import { EmailAttempt, EmailJob, Usage } from "@/modules/email/models";
import {
  authenticateCredentials,
  currentSessionUser,
  registerAccount,
  requestChallenge,
  resetPassword,
  verifyEmail,
} from "@/modules/identity/service";
import { openPayload, tokenHash } from "@/lib/security/crypto";
import {
  dispatchIdentityEmail,
  reconcileIdentityEmail,
} from "@/modules/email/identity-delivery";
import { identityEmail } from "@/modules/email/templates";
import { sealPayload } from "@/lib/security/crypto";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { identityHandler } from "@/modules/identity/handlers";
import { csrfBootstrap } from "@/lib/security/csrf";
import type { IdentityEmailPayload } from "@/lib/providers/resend";

let database: MongoMemoryReplSet;
const password = "a long original password";
const email = "couple@example.com";
async function register(address = email) {
  await registerAccount(
    registrationSchema.parse({ name: "A couple", email: address, password }),
  );
  return User.findOne({ emailNormalized: address })
    .select("+passwordHash")
    .orFail();
}
async function latestToken(
  kind: "verifyEmail" | "resetPassword",
  address = email,
) {
  const job = await EmailJob.findOne({ kind, intendedRecipient: address })
    .sort({ createdAt: -1 })
    .select("+payloadCipher")
    .orFail();
  const payload = openPayload<IdentityEmailPayload>(
    job.payloadCipher!,
    `email:${job._id}`,
  );
  const token = new URL(payload.text.match(/https?:\/\/[^\s]+/)![0]).hash.slice(
    7,
  );
  return { job, token };
}
beforeAll(async () => {
  process.env.AUTH_SECRET = randomBytes(32).toString("base64");
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.TOKEN_ENCRYPTION_KEY_ID = "test-key";
  process.env.APP_ORIGIN = "http://localhost:3000";
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
  process.env.MONGODB_DB_NAME = "identity_isolated_test";
  await migrateIdentity();
});
beforeEach(async () => {
  process.env.EMAIL_MODE = "simulated";
  for (const collection of await mongoose.connection.db!.collections())
    await collection.deleteMany({});
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await mongoose.disconnect();
  await database?.stop();
});

describe("database migration readiness", () => {
  it.each([
    "missing validator",
    "warning validation",
    "wrong index keys",
    "wrong TTL",
  ])("rejects %s and accepts a repaired migration", async (defect) => {
    const db = mongoose.connection.db!;
    try {
      if (defect === "missing validator")
        await db.command({ collMod: "users", validator: {} });
      if (defect === "warning validation")
        await db.command({ collMod: "users", validationAction: "warn" });
      if (defect === "wrong TTL")
        await db.command({
          collMod: "authTokens",
          index: { name: "ttl_auth_expiry", expireAfterSeconds: 3600 },
        });
      if (defect === "wrong index keys") {
        await AuthToken.collection.dropIndex("uq_auth_token");
        await AuthToken.collection.createIndex(
          { emailNormalized: 1 },
          { name: "uq_auth_token", unique: true },
        );
      }
      await mongoose.disconnect();
      await expect(ensureIdentityDatabase()).rejects.toMatchObject({
        code: "SERVICE_NOT_CONFIGURED",
      });
    } finally {
      await connectDatabase();
      if (defect === "wrong index keys")
        await AuthToken.collection.dropIndex("uq_auth_token");
      if (defect === "wrong TTL")
        await mongoose.connection.db!.command({
          collMod: "authTokens",
          index: { name: "ttl_auth_expiry", expireAfterSeconds: 0 },
        });
      await migrateIdentity();
    }
    await ensureIdentityDatabase();
  });
});

describe("identity lifecycle against real MongoDB indexes and transactions", () => {
  it("registers one normalized account, hashes passwords, and simulates without provider quota", async () => {
    await Promise.all([
      registerAccount(
        registrationSchema.parse({
          name: "One",
          email: " COUPLE@EXAMPLE.COM ",
          password,
        }),
      ),
      registerAccount(
        registrationSchema.parse({ name: "Two", email, password }),
      ),
    ]);
    expect(await User.countDocuments()).toBe(1);
    expect((await User.findOne().lean())?.passwordHash).toBeUndefined();
    const user = await User.findOne().select("+passwordHash").orFail();
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await authenticateCredentials({ email, password })).toMatchObject({
      id: String(user._id),
    });
    expect(
      await authenticateCredentials({ email, password: "incorrect" }),
    ).toBeNull();
    expect(await Usage.countDocuments()).toBe(0);
    expect(await EmailJob.countDocuments({ state: "simulated" })).toBe(1);
  });
  it("requires explicit, single-use verification and rejects expired or wrong-purpose tokens", async () => {
    await register();
    const { token } = await latestToken("verifyEmail");
    expect((await User.findOne())?.emailVerifiedAt).toBeUndefined();
    expect((await AuthToken.findOne())?.tokenHash).toBe(tokenHash(token));
    await expect(
      resetPassword({ token, newPassword: "new sufficiently long password" }),
    ).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
    await verifyEmail({ token });
    expect((await User.findOne())?.emailVerifiedAt).toBeInstanceOf(Date);
    await expect(verifyEmail({ token })).rejects.toMatchObject({
      code: "LINK_UNAVAILABLE",
    });
    await register("other@example.com");
    const expired = await latestToken("verifyEmail", "other@example.com");
    await AuthToken.updateOne(
      { tokenHash: tokenHash(expired.token) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await expect(verifyEmail({ token: expired.token })).rejects.toMatchObject({
      code: "LINK_UNAVAILABLE",
    });
  });
  it("replaces challenges and resets passwords atomically, invalidating existing sessions", async () => {
    const user = await register();
    await requestChallenge({ email }, "resetPassword");
    const old = await latestToken("resetPassword");
    await requestChallenge({ email }, "resetPassword");
    const fresh = await latestToken("resetPassword");
    await expect(
      resetPassword({ token: old.token, newPassword: "another long password" }),
    ).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
    await Promise.allSettled([
      resetPassword({
        token: fresh.token,
        newPassword: "the new long password",
      }),
      resetPassword({
        token: fresh.token,
        newPassword: "the new long password",
      }),
    ]).then((results) =>
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1),
    );
    expect(await currentSessionUser(String(user._id), 0)).toBeNull();
    expect(await authenticateCredentials({ email, password })).toBeNull();
    expect(
      await authenticateCredentials({
        email,
        password: "the new long password",
      }),
    ).toMatchObject({ sessionVersion: 1 });
    expect(
      (await AuthToken.findOne({ tokenHash: tokenHash(fresh.token) }))
        ?.consumedAt,
    ).toBeInstanceOf(Date);
  });
  it("blocks disabled accounts and atomically limits concurrent attempts", async () => {
    const user = await register();
    await User.updateOne({ _id: user._id }, { $set: { status: "disabled" } });
    expect(await authenticateCredentials({ email, password })).toBeNull();
    expect(await currentSessionUser(String(user._id), 0)).toBeNull();
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        consumeRateLimit("race", "same", 3, 60000),
      ),
    );
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(3);
  });
  it("preserves generic acknowledgements, CSRF, strict JSON and response privacy", async () => {
    const csrf = csrfBootstrap(
      new NextRequest("http://localhost:3000/api/v1/csrf"),
    );
    const cookie = csrf.headers.get("set-cookie")!.split(";")[0];
    const { data } = await csrf.json();
    const request = (body: unknown, origin = "http://localhost:3000") =>
      new NextRequest("http://localhost:3000/api/v1/identity/forgot-password", {
        method: "POST",
        headers: {
          cookie,
          origin,
          "content-type": "application/json",
          "x-csrf-token": data.csrfToken,
        },
        body: JSON.stringify(body),
      });
    const handler = identityHandler("forgot-password");
    const response = await handler(request({ email: "absent@example.com" }));
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toHaveProperty("data.message");
    expect((await handler(request({ email, extra: true }))).status).toBe(422);
    expect(
      (await handler(request({ email }, "https://attacker.example"))).status,
    ).toBe(403);
    expect((await handler(request({ email: "x".repeat(270000) }))).status).toBe(
      413,
    );
  });
  it("enforces critical validators and email uniqueness for direct database writes", async () => {
    const user = await register();
    await expect(
      mongoose.connection
        .db!.collection("users")
        .insertOne({ emailNormalized: "bad@example.com" }),
    ).rejects.toMatchObject({ code: 121 });
    await expect(
      User.create({
        name: "Duplicate",
        emailNormalized: user.emailNormalized,
        passwordHash: user.passwordHash,
      }),
    ).rejects.toMatchObject({ code: 11000 });
    expect(
      resetSchema.safeParse({ token: "x".repeat(43), newPassword: "  short  " })
        .success,
    ).toBe(false);
  });
});

function configureRealTest(limit = 100) {
  process.env.EMAIL_MODE = "test";
  process.env.RESEND_API_KEY = "isolated-provider-stub";
  process.env.EMAIL_TEST_RECIPIENT = email;
  process.env.EMAIL_QUOTA_NAMESPACE = "isolated-tests";
  process.env.EMAIL_DAILY_LIMIT = String(limit);
  process.env.EMAIL_MONTHLY_LIMIT = "3000";
  process.env.EMAIL_MONTH_WINDOW_START = new Date(
    Date.now() - 86400000,
  ).toISOString();
  process.env.EMAIL_MONTH_WINDOW_END = new Date(
    Date.now() + 86400000,
  ).toISOString();
}
async function pendingJob() {
  await register();
  const { job } = await latestToken("verifyEmail");
  configureRealTest();
  await EmailJob.updateOne(
    { _id: job._id },
    { $set: { mode: "test", state: "pending" } },
  );
  return job;
}

describe("durable identity email safety", () => {
  it("binds encrypted payloads to their job and labels test messages", () => {
    const payload = identityEmail(
      "verifyEmail",
      "https://example.com/verify-email#token=fixture",
      "sender@example.com",
      email,
      true,
    );
    expect(payload.subject).toMatch(/^\[TEST\]/);
    const sealed = sealPayload(payload, "email:one");
    expect(openPayload(sealed, "email:one")).toEqual(payload);
    expect(() => openPayload(sealed, "email:another")).toThrow();
    expect(() =>
      openPayload({ ...sealed, keyId: "missing-key" }, "email:one"),
    ).toThrow();
  });
  it("holds quota on uncertain outcomes and never automatically sends again", async () => {
    const job = await pendingJob();
    const send = vi.fn(async () => ({
      outcome: "unknown" as const,
      code: "TIMEOUT",
    }));
    await dispatchIdentityEmail(job._id, send);
    await dispatchIdentityEmail(job._id, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await EmailJob.findById(job._id))?.state).toBe("needsReview");
    expect(await Usage.find().lean()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reserved: 0, held: 1, consumed: 0 }),
      ]),
    );
    expect((await EmailAttempt.findOne())?.outcome).toBe("unknown");
  });
  it("consumes accepted reservations once and releases definite provider rejections", async () => {
    const job = await pendingJob();
    await dispatchIdentityEmail(job._id, async () => ({
      outcome: "accepted",
      messageId: "provider-test-id",
    }));
    expect((await EmailJob.findById(job._id))?.state).toBe("accepted");
    expect((await Usage.findOne())?.consumed).toBe(1);
    // A fresh explicit request has a new token; a definite rejection releases both counters.
    process.env.EMAIL_MODE = "simulated";
    await requestChallenge({ email }, "resetPassword");
    const next = await latestToken("resetPassword");
    process.env.EMAIL_MODE = "test";
    await EmailJob.updateOne(
      { _id: next.job._id },
      { $set: { mode: "test", state: "pending" } },
    );
    await dispatchIdentityEmail(next.job._id, async () => ({
      outcome: "rejected",
      retryable: false,
      code: "REJECTED",
    }));
    expect((await Usage.findOne())?.reserved).toBe(0);
    expect((await Usage.findOne())?.consumed).toBe(1);
  });
  it("defers when the global allowance is exhausted and cancels stale challenges", async () => {
    const job = await pendingJob();
    process.env.EMAIL_DAILY_LIMIT = "1";
    await dispatchIdentityEmail(job._id, async () => ({
      outcome: "accepted",
      messageId: "one",
    }));
    process.env.EMAIL_MODE = "simulated";
    await requestChallenge({ email }, "resetPassword");
    const next = await latestToken("resetPassword");
    process.env.EMAIL_MODE = "test";
    await EmailJob.updateOne(
      { _id: next.job._id },
      { $set: { mode: "test", state: "pending" } },
    );
    const send = vi.fn();
    await dispatchIdentityEmail(next.job._id, send);
    expect(send).not.toHaveBeenCalled();
    expect((await EmailJob.findById(next.job._id))?.state).toBe(
      "deferredQuota",
    );
    expect((await Usage.findOne())?.reserved).toBe(0);
  });
  it("cancels unsent work after its challenge expires, even before TTL cleanup", async () => {
    const job = await pendingJob();
    await AuthToken.updateOne(
      { _id: job.subjectId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expect(await reconcileIdentityEmail()).toBe(1);
    expect((await EmailJob.findById(job._id))?.state).toBe("cancelled");
    expect(await Usage.countDocuments()).toBe(0);
  });
  it("never redirects another account’s identity proof to a test inbox", async () => {
    configureRealTest();
    await register("another@example.com");
    expect(await AuthToken.countDocuments()).toBe(0);
    expect(await EmailJob.countDocuments()).toBe(0);
  });
  it("conservatively reconciles interrupted sends without sending again", async () => {
    const job = await pendingJob();
    await dispatchIdentityEmail(job._id, async () => ({
      outcome: "unknown",
      code: "UNCERTAIN",
    }));
    expect(await reconcileIdentityEmail()).toBe(0); // Already held; no duplicate settlement.
    expect((await Usage.findOne())?.held).toBe(1);
  });
  it("settles an expired post-dispatch lease into held quota exactly once", async () => {
    const job = await pendingJob();
    await dispatchIdentityEmail(job._id, async () => ({
      outcome: "unknown",
      code: "UNCERTAIN",
    }));
    // Model a process dying after the provider call but before database settlement.
    await Usage.updateMany({}, { $set: { reserved: 1, held: 0 } });
    await EmailJob.updateOne(
      { _id: job._id },
      {
        $set: {
          state: "processing",
          "quota.state": "reserved",
          lease: { id: "interrupted", until: new Date(Date.now() - 1000) },
        },
      },
    );
    await EmailAttempt.updateOne(
      { jobId: job._id },
      { $set: { outcome: "started" }, $unset: { finishedAt: "" } },
    );
    expect(await reconcileIdentityEmail()).toBe(1);
    expect(await reconcileIdentityEmail()).toBe(0);
    expect((await Usage.findOne())?.held).toBe(1);
    expect((await Usage.findOne())?.reserved).toBe(0);
    expect((await EmailJob.findById(job._id))?.state).toBe("needsReview");
  });
  it("enforces a shared single-send allowance under concurrent dispatches", async () => {
    const first = await pendingJob();
    process.env.EMAIL_MODE = "simulated";
    await requestChallenge({ email }, "resetPassword");
    const second = await latestToken("resetPassword");
    process.env.EMAIL_MODE = "test";
    process.env.EMAIL_DAILY_LIMIT = "1";
    await EmailJob.updateOne(
      { _id: second.job._id },
      { $set: { mode: "test", state: "pending" } },
    );
    const send = vi.fn(async () => ({
      outcome: "accepted" as const,
      messageId: "one-allowance",
    }));
    await Promise.all([
      dispatchIdentityEmail(first._id, send),
      dispatchIdentityEmail(second.job._id, send),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await EmailJob.countDocuments({ state: "accepted" })).toBe(1);
    expect(await EmailJob.countDocuments({ state: "deferredQuota" })).toBe(1);
    for (const counter of await Usage.find()) {
      expect(counter.reserved).toBe(0);
      expect(counter.consumed).toBe(1);
    }
  });
});

const RealDate = Date;
function clockAt(iso: string) {
  let time = RealDate.parse(iso);
  vi.stubGlobal(
    "Date",
    new Proxy(RealDate, {
      construct(target, args) {
        return Reflect.construct(target, args.length ? args : [time]);
      },
      get(target, key) {
        return key === "now" ? () => time : Reflect.get(target, key);
      },
    }),
  );
  return (value: string) => {
    time = RealDate.parse(value);
  };
}
async function anotherPendingJob() {
  process.env.EMAIL_MODE = "simulated";
  await requestChallenge({ email }, "resetPassword");
  const next = await latestToken("resetPassword");
  process.env.EMAIL_MODE = "test";
  await EmailJob.updateOne(
    { _id: next.job._id },
    { $set: { state: "pending", mode: "test" } },
  );
  return next.job;
}
describe("quota rollover", () => {
  it("serializes concurrent claims against carried capacity", async () => {
    const advance = clockAt("2029-02-14T23:59:59.000Z");
    const first = await pendingJob();
    process.env.EMAIL_DAILY_LIMIT = "2";
    process.env.EMAIL_MONTH_WINDOW_START = "2029-02-01T00:00:00.000Z";
    process.env.EMAIL_MONTH_WINDOW_END = "2029-03-01T00:00:00.000Z";
    await dispatchIdentityEmail(first._id, async () => {
      advance("2029-02-15T00:00:01.000Z");
      return { outcome: "accepted", messageId: "carried" };
    });
    process.env.EMAIL_MODE = "simulated";
    await requestChallenge({ email }, "verifyEmail");
    const verification = await latestToken("verifyEmail");
    const reset = await anotherPendingJob();
    await EmailJob.updateOne(
      { _id: verification.job._id },
      { $set: { mode: "test", state: "pending" } },
    );
    const send = vi.fn(async () => ({
      outcome: "accepted" as const,
      messageId: "remaining-slot",
    }));
    await Promise.all([
      dispatchIdentityEmail(verification.job._id, send),
      dispatchIdentityEmail(reset._id, send),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    const current = await Usage.findOne({
      kind: "emailDay",
      windowStart: new Date("2029-02-15T00:00:00.000Z"),
    }).orFail();
    expect(current).toMatchObject({
      consumed: 1,
      held: 1,
      carryHeld: 1,
      reserved: 0,
      limit: 2,
    });
  });
  it.each(["daily", "monthly"])(
    "holds late acceptance against the new %s window",
    async (period) => {
      const month = period === "monthly";
      const advance = clockAt(
        month ? "2029-02-28T23:59:59.000Z" : "2029-02-14T23:59:59.000Z",
      );
      const job = await pendingJob();
      process.env.EMAIL_MONTH_WINDOW_START = "2029-02-01T00:00:00.000Z";
      process.env.EMAIL_MONTH_WINDOW_END = "2029-03-01T00:00:00.000Z";
      process.env.EMAIL_DAILY_LIMIT = month ? "100" : "1";
      process.env.EMAIL_MONTHLY_LIMIT = month ? "1" : "3000";
      await dispatchIdentityEmail(job._id, async () => {
        advance(
          month ? "2029-03-01T00:00:01.000Z" : "2029-02-15T00:00:01.000Z",
        );
        return { outcome: "accepted", messageId: "late-acceptance" };
      });
      if (month) {
        process.env.EMAIL_MONTH_WINDOW_START = "2029-03-01T00:00:00.000Z";
        process.env.EMAIL_MONTH_WINDOW_END = "2029-04-01T00:00:00.000Z";
      }
      const next = await anotherPendingJob();
      const send = vi.fn();
      await dispatchIdentityEmail(next._id, send);
      expect(send).not.toHaveBeenCalled();
      expect((await EmailJob.findById(next._id))?.state).toBe("deferredQuota");
      const current = await Usage.findOne({
        kind: month ? "emailMonth" : "emailDay",
        windowStart: new Date(
          month ? "2029-03-01T00:00:00.000Z" : "2029-02-15T00:00:00.000Z",
        ),
      }).orFail();
      expect(current).toMatchObject({
        held: 1,
        carryHeld: 1,
        reserved: 0,
        consumed: 0,
      });
      const old = await Usage.findOne({
        kind: month ? "emailMonth" : "emailDay",
        windowEnd: current.windowStart,
      }).orFail();
      expect(old.consumed).toBe(1);
    },
  );
  it.each(["unknown", "in-flight", "rejected"])(
    "handles %s delivery at reset without double spending",
    async (outcome) => {
      const advance = clockAt("2029-02-14T23:59:59.000Z");
      const job = await pendingJob();
      process.env.EMAIL_DAILY_LIMIT = "1";
      process.env.EMAIL_MONTH_WINDOW_START = "2029-02-01T00:00:00.000Z";
      process.env.EMAIL_MONTH_WINDOW_END = "2029-03-01T00:00:00.000Z";
      let finish: (() => void) | undefined;
      let reached: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const release = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const first = dispatchIdentityEmail(job._id, async () => {
        if (outcome === "in-flight") {
          reached!();
          await release;
        }
        advance("2029-02-15T00:00:01.000Z");
        return outcome === "rejected"
          ? { outcome: "rejected", retryable: false, code: "REJECTED" }
          : outcome === "unknown"
            ? { outcome: "unknown", code: "UNCERTAIN" }
            : { outcome: "accepted", messageId: "in-flight-acceptance" };
      });
      if (outcome === "in-flight") {
        await started;
        advance("2029-02-15T00:00:01.000Z");
      } else await first;
      try {
        const next = await anotherPendingJob();
        const send = vi.fn(async () => ({
          outcome: "accepted" as const,
          messageId: "new-send",
        }));
        await dispatchIdentityEmail(next._id, send);
        expect(send).toHaveBeenCalledTimes(outcome === "rejected" ? 1 : 0);
        const current = await Usage.findOne({
          kind: "emailDay",
          windowStart: new Date("2029-02-15T00:00:00.000Z"),
        }).orFail();
        expect(current.consumed + current.held + current.reserved).toBe(1);
      } finally {
        finish!();
        await first;
      }
    },
  );
});
