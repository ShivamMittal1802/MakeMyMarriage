import "server-only";
import { createHmac } from "node:crypto";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { authSecret } from "@/lib/config/server";
import { commonFields, duplicateKey, modelOptions } from "@/lib/db/connection";
import { AppError } from "@/lib/http/errors";
import { ensureIdentityDatabase } from "@/lib/db/readiness";

const schema = new Schema(
  {
    ...commonFields,
    scopeKey: { type: String, required: true },
    windowStart: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    count: { type: Number, required: true, default: 0 },
  },
  modelOptions("rateLimits"),
);
schema.index(
  { scopeKey: 1, windowStart: 1 },
  { name: "uq_rate_window", unique: true },
);
schema.index(
  { expiresAt: 1 },
  { name: "ttl_rate_expiry", expireAfterSeconds: 0 },
);
type RateRecord = InferSchemaType<typeof schema>;
export const RateLimit: Model<RateRecord> =
  (mongoose.models.SecurityRateLimit as Model<RateRecord> | undefined) ??
  mongoose.model<RateRecord>("SecurityRateLimit", schema);

export async function consumeRateLimit(
  purpose: string,
  identity: string,
  limit: number,
  windowMs: number,
  now = new Date(),
) {
  await ensureIdentityDatabase();
  const scopeKey = createHmac("sha256", authSecret())
    .update(`${purpose}:${identity}`)
    .digest("hex");
  const start = Math.floor(now.getTime() / windowMs) * windowMs;
  const filter = { scopeKey, windowStart: new Date(start) };
  const update = {
    $inc: { count: 1, version: 1 },
    $setOnInsert: { expiresAt: new Date(start + windowMs), schemaVersion: 1 },
  };
  let row;
  try {
    row = await RateLimit.findOneAndUpdate(filter, update, {
      upsert: true,
      returnDocument: "after",
      setDefaultsOnInsert: false,
    }).lean();
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    row = await RateLimit.findOneAndUpdate(filter, update, {
      returnDocument: "after",
    }).lean();
  }
  if (!row || row.count > limit)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Too many attempts. Please try again later.",
      {
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((start + windowMs - now.getTime()) / 1000),
        ),
      },
    );
}

export function requestNetworkKey(request: Request) {
  // Only the deployment platform's overwritten header is trusted. Local requests share a bucket.
  return process.env.VERCEL === "1"
    ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown"
    : "local";
}
