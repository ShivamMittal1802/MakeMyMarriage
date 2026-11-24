import "server-only";
import { randomUUID } from "node:crypto";
import { Types, type ClientSession } from "mongoose";
import { appOrigin, emailConfig } from "@/lib/config/server";
import { duplicateKey, transaction } from "@/lib/db/connection";
import { ensureIdentityDatabase } from "@/lib/db/readiness";
import { openPayload, sealPayload, tokenHash } from "@/lib/security/crypto";
import {
  sendIdentityEmail,
  type EmailTransport,
  type IdentityEmailPayload,
  type DeliveryResult,
} from "@/lib/providers/resend";
import { AuthToken, User } from "@/modules/identity/models";
import type { IdentityPurpose } from "@/modules/identity/schemas";
import { EmailAttempt, EmailJob, EmailOperation, Usage } from "./models";
import { identityEmail } from "./templates";

import { reserveEmailQuota } from "./quota";

export function identityDeliveryAllowed(email: string) {
  const config = emailConfig();
  // A redirected identity challenge must never prove ownership of a different address.
  return config.mode !== "test" || email === config.testRecipient;
}

export async function queueIdentityEmail(
  input: {
    userId: Types.ObjectId;
    email: string;
    purpose: IdentityPurpose;
    tokenId: Types.ObjectId;
    rawToken: string;
  },
  session: ClientSession,
) {
  const config = emailConfig();
  const operationId = new Types.ObjectId();
  const jobId = new Types.ObjectId();
  const scopeKey = `user:${input.userId}`;
  // Fragments stay out of HTTP access logs and referrers. Consumption still requires an explicit POST.
  const path =
    input.purpose === "verifyEmail" ? "/verify-email" : "/reset-password";
  const link = `${appOrigin()}${path}#token=${input.rawToken}`;
  const payload = identityEmail(
    input.purpose,
    link,
    config.from,
    input.email,
    config.mode === "test",
  );
  const payloadHash = tokenHash(JSON.stringify(payload));
  await EmailOperation.create(
    [
      {
        _id: operationId,
        scopeKey,
        kind: input.purpose,
        mode: config.mode,
        requestKey: randomUUID(),
        requestHash: payloadHash,
        status: "open",
        expectedJobs: 1,
      },
    ],
    { session },
  );
  await EmailJob.create(
    [
      {
        _id: jobId,
        operationId,
        scopeKey,
        subjectType: "authToken",
        subjectId: input.tokenId,
        subjectKey: `authToken:${input.tokenId}`,
        intendedRecipient: input.email,
        actualRecipient: input.email,
        mode: config.mode,
        kind: input.purpose,
        payloadCipher: sealPayload(payload, `email:${jobId}`),
        payloadHash,
        idempotencyKey: `identity:${config.namespace}:${config.mode}:${jobId}`,
        state: "pending",
      },
    ],
    { session },
  );
  return jobId;
}

async function settleCounters(
  quota: { dayId: string; monthId: string },
  outcome: "consumed" | "held" | "released",
  session: ClientSession,
) {
  for (const id of [quota.dayId, quota.monthId]) {
    const result = await Usage.updateOne(
      { _id: id, reserved: { $gte: 1 } },
      {
        $inc: {
          reserved: -1,
          version: 1,
          ...(outcome === "released" ? {} : { [outcome]: 1 }),
        },
      },
      { session },
    );
    if (result.modifiedCount !== 1)
      throw new Error("Email quota accounting conflict");
  }
}

export async function cancelIdentityJobs(
  tokenIds: Types.ObjectId[],
  session: ClientSession,
  now: Date,
) {
  if (!tokenIds.length) return;
  const jobs = await EmailJob.find({
    subjectType: "authToken",
    subjectId: { $in: tokenIds },
    state: {
      $in: [
        "pending",
        "deferredQuota",
        "retryableFailed",
        "processing",
        "needsReview",
      ],
    },
  }).session(session);
  for (const job of jobs) {
    if (job.dispatchStartedAt) {
      await EmailJob.updateOne(
        { _id: job._id },
        {
          $set: { cancelRequestedAt: now, cancelReason: "challengeReplaced" },
          $inc: { version: 1 },
        },
        { session },
      );
      continue;
    }
    if (job.quota?.state === "reserved")
      await settleCounters(job.quota, "released", session);
    await EmailJob.updateOne(
      { _id: job._id, dispatchStartedAt: { $exists: false } },
      {
        $set: {
          state: "cancelled",
          cancelRequestedAt: now,
          cancelReason: "challengeReplaced",
          ...(job.quota ? { "quota.state": "released" } : {}),
        },
        $unset: { lease: "" },
        $inc: { version: 1 },
      },
      { session },
    );
    await EmailOperation.updateOne(
      { _id: job.operationId },
      { $set: { status: "cancelled" }, $inc: { version: 1 } },
      { session },
    );
  }
}

async function activeChallenge(
  subjectId: Types.ObjectId,
  session: ClientSession,
  now: Date,
) {
  const token = await AuthToken.findOneAndUpdate(
    {
      _id: subjectId,
      expiresAt: { $gt: now },
      consumedAt: { $exists: false },
      revokedAt: { $exists: false },
    },
    { $inc: { version: 1 } },
    { session, returnDocument: "after" },
  );
  if (!token) return false;
  const user = await User.findOneAndUpdate(
    {
      _id: token.userId,
      status: "active",
      emailNormalized: token.emailNormalized,
      sessionVersion: token.issuedSessionVersion,
      ...(token.purpose === "verifyEmail"
        ? { emailVerifiedAt: { $exists: false } }
        : {}),
    },
    { $inc: { version: 1 } },
    { session },
  );
  return !!user;
}

export async function dispatchIdentityEmail(
  jobId: Types.ObjectId,
  transport: EmailTransport = sendIdentityEmail,
  windowRetry = 0,
) {
  await ensureIdentityDatabase();
  const leaseId = randomUUID();
  let claimed;
  try {
    claimed = await transaction(async (session) => {
      const now = new Date();
      const job = await EmailJob.findOneAndUpdate(
        {
          _id: jobId,
          state: "pending",
          subjectType: "authToken",
          cancelRequestedAt: { $exists: false },
        },
        {
          $set: {
            state: "processing",
            lease: { id: leaseId, until: new Date(now.getTime() + 60_000) },
          },
          $inc: { version: 1 },
        },
        { session, returnDocument: "after" },
      ).select("+payloadCipher");
      if (!job) return null;
      const config = emailConfig(now);
      if (
        job.mode !== config.mode ||
        !identityDeliveryAllowed(job.intendedRecipient) ||
        !(await activeChallenge(job.subjectId, session, now))
      ) {
        await EmailJob.updateOne(
          { _id: jobId },
          {
            $set: { state: "cancelled", cancelReason: "challengeUnavailable" },
            $unset: { lease: "" },
            $inc: { version: 1 },
          },
          { session },
        );
        await EmailOperation.updateOne(
          { _id: job.operationId },
          { $set: { status: "cancelled" }, $inc: { version: 1 } },
          { session },
        );
        return null;
      }
      if (job.mode === "simulated") {
        await EmailJob.updateOne(
          { _id: jobId },
          {
            $set: { state: "simulated" },
            $unset: { lease: "" },
            $inc: { version: 1 },
          },
          { session },
        );
        await EmailOperation.updateOne(
          { _id: job.operationId },
          { $set: { status: "closed" }, $inc: { version: 1 } },
          { session },
        );
        return null;
      }
      const quota = await reserveEmailQuota(session, now);
      if (!quota) {
        // Commit refreshed carry-over holds even when this request cannot send.
        await EmailJob.updateOne(
          { _id: jobId, "lease.id": leaseId },
          {
            $set: {
              state: "deferredQuota",
              lastErrorCode: "EMAIL_QUOTA_EXHAUSTED",
            },
            $unset: { lease: "" },
            $inc: { version: 1 },
          },
          { session },
        );
        return null;
      }
      await EmailJob.updateOne(
        { _id: jobId },
        { $set: { quota }, $inc: { version: 1 } },
        { session },
      );
      return { job, quota };
    });
  } catch (error) {
    // A concurrent first reservation may win creation of a shared window. The
    // aborted transaction made no claim or reservation, so a bounded retry is safe.
    if (duplicateKey(error) && windowRetry < 1)
      return dispatchIdentityEmail(jobId, transport, windowRetry + 1);
    throw error;
  }
  if (!claimed) return;

  let payload: IdentityEmailPayload;
  try {
    payload = openPayload<IdentityEmailPayload>(
      claimed.job.payloadCipher!,
      `email:${jobId}`,
    );
    if (
      tokenHash(JSON.stringify(payload)) !== claimed.job.payloadHash ||
      payload.to !== claimed.job.actualRecipient
    )
      throw new Error();
  } catch {
    await transaction(async (session) => {
      const changed = await EmailJob.updateOne(
        {
          _id: jobId,
          state: "processing",
          "lease.id": leaseId,
          dispatchStartedAt: { $exists: false },
        },
        {
          $set: {
            state: "permanentlyFailed",
            "quota.state": "released",
            lastErrorCode: "PAYLOAD_UNAVAILABLE",
          },
          $unset: { lease: "" },
          $inc: { version: 1 },
        },
        { session },
      );
      if (changed.modifiedCount)
        await settleCounters(claimed.quota, "released", session);
      if (changed.modifiedCount)
        await EmailOperation.updateOne(
          { _id: claimed.job.operationId },
          { $set: { status: "closed" }, $inc: { version: 1 } },
          { session },
        );
    });
    return;
  }

  const canDispatch = await transaction(async (session) => {
    const now = new Date();
    const job = await EmailJob.findOne({
      _id: jobId,
      state: "processing",
      "lease.id": leaseId,
      "lease.until": { $gt: now },
      dispatchStartedAt: { $exists: false },
      cancelRequestedAt: { $exists: false },
    }).session(session);
    if (!job) return false;
    const day = await Usage.findById(claimed.quota.dayId).session(session);
    const month = await Usage.findById(claimed.quota.monthId).session(session);
    if (
      !day ||
      !month ||
      day.windowEnd <= now ||
      month.windowEnd <= now ||
      !(await activeChallenge(job.subjectId, session, now))
    ) {
      await settleCounters(claimed.quota, "released", session);
      await EmailJob.updateOne(
        { _id: jobId },
        {
          $set: {
            state: "cancelled",
            "quota.state": "released",
            cancelReason: "challengeOrWindowExpired",
          },
          $unset: { lease: "" },
          $inc: { version: 1 },
        },
        { session },
      );
      await EmailOperation.updateOne(
        { _id: job.operationId },
        { $set: { status: "cancelled" }, $inc: { version: 1 } },
        { session },
      );
      return false;
    }
    await EmailJob.updateOne(
      { _id: jobId, "lease.id": leaseId },
      {
        $set: { dispatchStartedAt: now, firstAttemptAt: now },
        $inc: { attemptCount: 1, version: 1 },
      },
      { session },
    );
    await EmailAttempt.create(
      [
        {
          jobId,
          operationId: job.operationId,
          attemptNo: 1,
          leaseId,
          startedAt: now,
          outcome: "started",
        },
      ],
      { session },
    );
    return true;
  });
  if (!canDispatch) return;
  let result: DeliveryResult;
  try {
    result = await transport(payload, claimed.job.idempotencyKey);
  } catch {
    result = { outcome: "unknown", code: "PROVIDER_OUTCOME_UNKNOWN" };
  }

  await transaction(async (session) => {
    const state =
      result.outcome === "accepted"
        ? "accepted"
        : result.outcome === "unknown"
          ? "needsReview"
          : result.retryable
            ? "retryableFailed"
            : "permanentlyFailed";
    const quotaState =
      result.outcome === "accepted"
        ? "consumed"
        : result.outcome === "unknown"
          ? "held"
          : "released";
    const now = new Date();
    const changed = await EmailJob.updateOne(
      {
        _id: jobId,
        state: "processing",
        "lease.id": leaseId,
        "quota.state": "reserved",
      },
      {
        $set: {
          state,
          "quota.state": quotaState,
          ...(result.outcome === "accepted"
            ? { providerMessageId: result.messageId, acceptedAt: now }
            : { lastErrorCode: result.code }),
          ...(result.outcome === "rejected" && result.retryable
            ? { retryNotBefore: new Date(now.getTime() + 60_000) }
            : {}),
        },
        $unset: { lease: "" },
        $inc: { version: 1 },
      },
      { session },
    );
    if (!changed.modifiedCount) return;
    await settleCounters(claimed.quota, quotaState, session);
    await EmailAttempt.updateOne(
      { jobId, attemptNo: 1, leaseId },
      {
        $set: {
          outcome: result.outcome,
          finishedAt: now,
          ...(result.outcome === "accepted"
            ? { providerMessageId: result.messageId }
            : { errorCode: result.code }),
        },
        $inc: { version: 1 },
      },
      { session },
    );
    await EmailOperation.updateOne(
      { _id: claimed.job.operationId },
      {
        $set: {
          status:
            state === "retryableFailed" || state === "needsReview"
              ? "open"
              : "closed",
        },
        $inc: { version: 1 },
      },
      { session },
    );
  });
}

/** Bounded operator recovery. Unknown sends keep their allowance held forever
 * unless provider evidence is reviewed; this command never sends email. */
export async function reconcileIdentityEmail(limit = 100) {
  await ensureIdentityDatabase();
  const now = new Date();
  const jobs = await EmailJob.find({
    subjectType: "authToken",
    state: "processing",
    "lease.until": { $lte: now },
  })
    .sort({ _id: 1 })
    .limit(Math.min(100, Math.max(1, limit)))
    .select("_id");
  let reconciled = 0;
  for (const candidate of jobs) {
    const changed = await transaction(async (session) => {
      const job = await EmailJob.findOne({
        _id: candidate._id,
        state: "processing",
        "lease.until": { $lte: now },
      }).session(session);
      if (!job) return false;
      const ambiguous = !!job.dispatchStartedAt;
      if (job.quota?.state === "reserved")
        await settleCounters(
          job.quota,
          ambiguous ? "held" : "released",
          session,
        );
      await EmailJob.updateOne(
        { _id: job._id, version: job.version },
        {
          $set: {
            state: ambiguous ? "needsReview" : "cancelled",
            lastErrorCode: ambiguous
              ? "INTERRUPTED_DISPATCH"
              : "INTERRUPTED_BEFORE_DISPATCH",
            ...(job.quota
              ? { "quota.state": ambiguous ? "held" : "released" }
              : {}),
          },
          $unset: { lease: "" },
          $inc: { version: 1 },
        },
        { session },
      );
      if (ambiguous)
        await EmailAttempt.updateOne(
          { jobId: job._id, outcome: "started" },
          {
            $set: {
              outcome: "unknown",
              finishedAt: now,
              errorCode: "INTERRUPTED_DISPATCH",
            },
            $inc: { version: 1 },
          },
          { session },
        );
      await EmailOperation.updateOne(
        { _id: job.operationId },
        {
          $set: { status: ambiguous ? "open" : "cancelled" },
          $inc: { version: 1 },
        },
        { session },
      );
      return true;
    });
    if (changed) reconciled++;
  }
  const remaining = Math.min(100, Math.max(1, limit)) - jobs.length;
  if (remaining <= 0) return reconciled;
  // Auth-token TTL may already have removed the disposable challenge. Keep the
  // durable delivery record, but close stale unsent work rather than sending it.
  const stale = await EmailJob.aggregate<{ _id: Types.ObjectId }>([
    {
      $match: {
        subjectType: "authToken",
        state: { $in: ["pending", "deferredQuota", "retryableFailed"] },
      },
    },
    {
      $lookup: {
        from: "authTokens",
        localField: "subjectId",
        foreignField: "_id",
        as: "challenge",
      },
    },
    {
      $match: {
        $or: [
          { challenge: { $size: 0 } },
          { "challenge.expiresAt": { $lte: now } },
          { "challenge.revokedAt": { $exists: true } },
          { "challenge.consumedAt": { $exists: true } },
        ],
      },
    },
    { $sort: { _id: 1 } },
    { $limit: remaining },
    { $project: { _id: 1 } },
  ]);
  for (const candidate of stale) {
    const changed = await transaction(async (session) => {
      const job = await EmailJob.findOne({
        _id: candidate._id,
        state: { $in: ["pending", "deferredQuota", "retryableFailed"] },
        dispatchStartedAt: { $exists: false },
      }).session(session);
      // A definite rejected attempt is also safe to close. No new call is made.
      const rejected =
        job ??
        (await EmailJob.findOne({
          _id: candidate._id,
          state: "retryableFailed",
          "quota.state": "released",
        }).session(session));
      if (
        !rejected ||
        (await activeChallenge(rejected.subjectId, session, now))
      )
        return false;
      await EmailJob.updateOne(
        { _id: rejected._id, version: rejected.version },
        {
          $set: { state: "cancelled", cancelReason: "challengeUnavailable" },
          $inc: { version: 1 },
        },
        { session },
      );
      await EmailOperation.updateOne(
        { _id: rejected.operationId },
        { $set: { status: "cancelled" }, $inc: { version: 1 } },
        { session },
      );
      return true;
    });
    if (changed) reconciled++;
  }
  return reconciled;
}
