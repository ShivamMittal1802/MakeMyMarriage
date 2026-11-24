import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { commonFields, modelOptions } from "@/lib/db/connection";

const userSchema = new Schema(
  {
    ...commonFields,
    name: { type: String, required: true, maxlength: 150 },
    emailNormalized: { type: String, required: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    emailVerifiedAt: Date,
    status: {
      type: String,
      enum: ["active", "disabled"],
      required: true,
      default: "active",
    },
    sessionVersion: { type: Number, required: true, default: 0, min: 0 },
  },
  modelOptions("users"),
);
userSchema.index(
  { emailNormalized: 1 },
  { name: "uq_user_email", unique: true },
);
export type UserRecord = InferSchemaType<typeof userSchema>;
export const User: Model<UserRecord> =
  (mongoose.models.IdentityUser as Model<UserRecord> | undefined) ??
  mongoose.model<UserRecord>("IdentityUser", userSchema);

const tokenSchema = new Schema(
  {
    ...commonFields,
    userId: { type: Schema.Types.ObjectId, required: true },
    purpose: {
      type: String,
      enum: ["verifyEmail", "resetPassword"],
      required: true,
    },
    emailNormalized: { type: String, required: true },
    tokenHash: { type: String, required: true },
    issuedSessionVersion: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: Date,
    revokedAt: Date,
  },
  modelOptions("authTokens"),
);
tokenSchema.index({ tokenHash: 1 }, { name: "uq_auth_token", unique: true });
tokenSchema.index({ userId: 1, purpose: 1 }, { name: "ix_auth_user_purpose" });
tokenSchema.index(
  { expiresAt: 1 },
  { name: "ttl_auth_expiry", expireAfterSeconds: 0 },
);
export type AuthTokenRecord = InferSchemaType<typeof tokenSchema>;
export const AuthToken: Model<AuthTokenRecord> =
  (mongoose.models.IdentityToken as Model<AuthTokenRecord> | undefined) ??
  mongoose.model<AuthTokenRecord>("IdentityToken", tokenSchema);
