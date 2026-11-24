import "server-only";
import { Types, type ClientSession } from "mongoose";
import {
  authSecret,
  appOrigin,
  encryptionConfig,
  emailConfig,
} from "@/lib/config/server";
import { duplicateKey, transaction } from "@/lib/db/connection";
import { ensureIdentityDatabase } from "@/lib/db/readiness";
import { AppError } from "@/lib/http/errors";
import { randomToken, tokenHash } from "@/lib/security/crypto";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  cancelIdentityJobs,
  dispatchIdentityEmail,
  identityDeliveryAllowed,
  queueIdentityEmail,
} from "@/modules/email/identity-delivery";
import { AuthToken, User } from "./models";
import { hashPassword, verifyPassword } from "./passwords";
import {
  type IdentityPurpose,
  registrationSchema,
  loginSchema,
  emailRequestSchema,
  verificationSchema,
  resetSchema,
} from "./schemas";
import type { z } from "zod";

function requireIdentityServices() {
  authSecret();
  appOrigin();
  encryptionConfig();
  emailConfig();
}

async function challenge(
  user: {
    _id: Types.ObjectId;
    emailNormalized: string;
    sessionVersion: number;
  },
  purpose: IdentityPurpose,
  session: ClientSession,
) {
  if (!identityDeliveryAllowed(user.emailNormalized)) return null;
  const now = new Date();
  const previous = await AuthToken.find({
    userId: user._id,
    purpose,
    consumedAt: { $exists: false },
    revokedAt: { $exists: false },
  })
    .session(session)
    .select("_id");
  await AuthToken.updateMany(
    { _id: { $in: previous.map((token) => token._id) } },
    { $set: { revokedAt: now }, $inc: { version: 1 } },
    { session },
  );
  await cancelIdentityJobs(
    previous.map((token) => token._id),
    session,
    now,
  );
  const rawToken = randomToken();
  const tokenId = new Types.ObjectId();
  await AuthToken.create(
    [
      {
        _id: tokenId,
        userId: user._id,
        purpose,
        emailNormalized: user.emailNormalized,
        issuedSessionVersion: user.sessionVersion,
        tokenHash: tokenHash(rawToken),
        expiresAt: new Date(
          now.getTime() + (purpose === "verifyEmail" ? 86_400_000 : 1_800_000),
        ),
      },
    ],
    { session },
  );
  return queueIdentityEmail(
    {
      userId: user._id,
      email: user.emailNormalized,
      purpose,
      tokenId,
      rawToken,
    },
    session,
  );
}

async function attemptDelivery(jobId: Types.ObjectId | null | undefined) {
  if (!jobId) return;
  // A committed identity request must keep its generic acknowledgement even if email fails.
  // Persisted job/attempt states support operator reconciliation; no secret is returned or logged.
  try {
    await dispatchIdentityEmail(jobId);
  } catch {
    console.error("identity_email_attempt_incomplete");
  }
}

export async function registerAccount(
  input: z.infer<typeof registrationSchema>,
) {
  requireIdentityServices();
  await ensureIdentityDatabase();
  await consumeRateLimit("register-email", input.email, 5, 3_600_000);
  const passwordHash = await hashPassword(input.password);
  let jobId: Types.ObjectId | null | undefined;
  try {
    jobId = await transaction(async (session) => {
      if (await User.exists({ emailNormalized: input.email }).session(session))
        return null;
      const [user] = await User.create(
        [{ name: input.name, emailNormalized: input.email, passwordHash }],
        { session },
      );
      return challenge(user, "verifyEmail", session);
    });
  } catch (error) {
    if (!duplicateKey(error)) throw error;
  }
  await attemptDelivery(jobId);
}

export async function requestChallenge(
  input: z.infer<typeof emailRequestSchema>,
  purpose: IdentityPurpose,
) {
  requireIdentityServices();
  await ensureIdentityDatabase();
  await consumeRateLimit(`challenge-${purpose}`, input.email, 3, 3_600_000);
  const jobId = await transaction(async (session) => {
    const user = await User.findOneAndUpdate(
      {
        emailNormalized: input.email,
        status: "active",
        ...(purpose === "verifyEmail"
          ? { emailVerifiedAt: { $exists: false } }
          : {}),
      },
      { $inc: { version: 1 } },
      { session, returnDocument: "after" },
    );
    return user ? challenge(user, purpose, session) : null;
  });
  await attemptDelivery(jobId);
}

function unavailableLink() {
  return new AppError(
    404,
    "LINK_UNAVAILABLE",
    "This link is invalid, expired, or already used. Request a new one.",
  );
}

export async function verifyEmail(input: z.infer<typeof verificationSchema>) {
  await ensureIdentityDatabase();
  await transaction(async (session) => {
    const now = new Date();
    const token = await AuthToken.findOneAndUpdate(
      {
        tokenHash: tokenHash(input.token),
        purpose: "verifyEmail",
        expiresAt: { $gt: now },
        consumedAt: { $exists: false },
        revokedAt: { $exists: false },
      },
      { $set: { consumedAt: now }, $inc: { version: 1 } },
      { session, returnDocument: "after" },
    );
    if (!token) throw unavailableLink();
    const updated = await User.updateOne(
      {
        _id: token.userId,
        emailNormalized: token.emailNormalized,
        status: "active",
        sessionVersion: token.issuedSessionVersion,
        emailVerifiedAt: { $exists: false },
      },
      { $set: { emailVerifiedAt: now }, $inc: { version: 1 } },
      { session },
    );
    if (!updated.modifiedCount) throw unavailableLink();
    await AuthToken.updateMany(
      {
        userId: token.userId,
        purpose: "verifyEmail",
        _id: { $ne: token._id },
        consumedAt: { $exists: false },
        revokedAt: { $exists: false },
      },
      { $set: { revokedAt: now }, $inc: { version: 1 } },
      { session },
    );
  });
}

export async function resetPassword(input: z.infer<typeof resetSchema>) {
  await ensureIdentityDatabase();
  const passwordHash = await hashPassword(input.newPassword);
  await transaction(async (session) => {
    const now = new Date();
    const token = await AuthToken.findOneAndUpdate(
      {
        tokenHash: tokenHash(input.token),
        purpose: "resetPassword",
        expiresAt: { $gt: now },
        consumedAt: { $exists: false },
        revokedAt: { $exists: false },
      },
      { $set: { consumedAt: now }, $inc: { version: 1 } },
      { session, returnDocument: "after" },
    );
    if (!token) throw unavailableLink();
    const user = await User.findOneAndUpdate(
      {
        _id: token.userId,
        status: "active",
        emailNormalized: token.emailNormalized,
        sessionVersion: token.issuedSessionVersion,
      },
      { $set: { passwordHash }, $inc: { sessionVersion: 1, version: 1 } },
      { session },
    );
    if (!user) throw unavailableLink();
    const obsolete = await AuthToken.find({
      userId: token.userId,
      _id: { $ne: token._id },
      consumedAt: { $exists: false },
      revokedAt: { $exists: false },
    })
      .session(session)
      .select("_id");
    await AuthToken.updateMany(
      { _id: { $in: obsolete.map((row) => row._id) } },
      { $set: { revokedAt: now }, $inc: { version: 1 } },
      { session },
    );
    await cancelIdentityJobs(
      obsolete.map((row) => row._id),
      session,
      now,
    );
  });
}

export async function authenticateCredentials(input: unknown) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return null;
  await ensureIdentityDatabase();
  await consumeRateLimit(
    "credential-email",
    parsed.data.email,
    10,
    15 * 60_000,
  );
  const user = await User.findOne({ emailNormalized: parsed.data.email })
    .select("+passwordHash")
    .lean();
  const valid = await verifyPassword(parsed.data.password, user?.passwordHash);
  if (!valid || !user || user.status !== "active") return null;
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.emailNormalized,
    sessionVersion: user.sessionVersion,
  };
}

export async function currentSessionUser(
  id: string | undefined,
  version: unknown,
) {
  if (
    !id ||
    !Types.ObjectId.isValid(id) ||
    typeof version !== "number" ||
    !Number.isSafeInteger(version)
  )
    return null;
  await ensureIdentityDatabase();
  return User.findOne({
    _id: id,
    status: "active",
    sessionVersion: version,
  }).lean();
}
