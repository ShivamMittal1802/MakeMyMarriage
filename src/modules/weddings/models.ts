import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { commonFields, modelOptions } from "@/lib/db/connection";
import { tokenEnvelopeSchema } from "@/lib/security/token-envelope";

const weddingSchema = new Schema(
  {
    ...commonFields,
    ownerUserId: { type: Schema.Types.ObjectId, required: true },
    slug: { type: String, required: true },
    couple: {
      brideName: { type: String, required: true, maxlength: 150 },
      groomName: { type: String, required: true, maxlength: 150 },
    },
    weddingDate: { type: String, required: true },
    location: { type: String, required: true, maxlength: 500 },
    introduction: { type: String, maxlength: 5000 },
    timezone: {
      type: String,
      required: true,
      enum: ["Asia/Kolkata"],
      default: "Asia/Kolkata",
    },
    currency: { type: String, required: true, enum: ["INR"], default: "INR" },
  },
  modelOptions("weddings"),
);
weddingSchema.index({ slug: 1 }, { unique: true, name: "uq_wedding_slug" });
weddingSchema.index(
  { ownerUserId: 1 },
  { unique: true, name: "uq_wedding_owner" },
);
export type WeddingRecord = InferSchemaType<typeof weddingSchema>;
export const Wedding: Model<WeddingRecord> =
  (mongoose.models.Wedding as Model<WeddingRecord> | undefined) ??
  mongoose.model<WeddingRecord>("Wedding", weddingSchema);

const membershipSchema = new Schema(
  {
    ...commonFields,
    weddingId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, required: true, enum: ["bride", "groom", "manager"] },
    status: {
      type: String,
      required: true,
      enum: ["active", "revoked"],
      default: "active",
    },
    joinedAt: { type: Date, required: true, default: Date.now },
    invitedBy: Schema.Types.ObjectId,
    revokedAt: Date,
    revokedBy: Schema.Types.ObjectId,
  },
  modelOptions("memberships"),
);
membershipSchema.index(
  { userId: 1 },
  {
    name: "uq_active_user_membership",
    unique: true,
    partialFilterExpression: { status: "active" },
  },
);
membershipSchema.index(
  { weddingId: 1, role: 1 },
  {
    name: "uq_active_couple_role",
    unique: true,
    partialFilterExpression: {
      status: "active",
      role: { $in: ["bride", "groom"] },
    },
  },
);
membershipSchema.index(
  { weddingId: 1, status: 1, joinedAt: 1, _id: 1 },
  { name: "ix_wedding_members" },
);
membershipSchema.index(
  { userId: 1, joinedAt: -1, _id: -1 },
  { name: "ix_user_membership_history" },
);
export type MembershipRecord = InferSchemaType<typeof membershipSchema>;
export const Membership: Model<MembershipRecord> =
  (mongoose.models.Membership as Model<MembershipRecord> | undefined) ??
  mongoose.model<MembershipRecord>("Membership", membershipSchema);

const inviteSchema = new Schema(
  {
    ...commonFields,
    weddingId: { type: Schema.Types.ObjectId, required: true },
    invitedBy: { type: Schema.Types.ObjectId, required: true },
    emailNormalized: { type: String, required: true },
    role: { type: String, required: true, enum: ["bride", "groom", "manager"] },
    status: {
      type: String,
      required: true,
      enum: ["pending", "accepted", "revoked", "expired"],
      default: "pending",
    },
    token: { type: tokenEnvelopeSchema, required: true, select: false },
    expiresAt: { type: Date, required: true },
    acceptedAt: Date,
    acceptedBy: Schema.Types.ObjectId,
    revokedAt: Date,
    revokedBy: Schema.Types.ObjectId,
  },
  modelOptions("memberInvitations"),
);
inviteSchema.index(
  { weddingId: 1, emailNormalized: 1 },
  {
    name: "uq_pending_member_email",
    unique: true,
    partialFilterExpression: { status: "pending" },
  },
);
inviteSchema.index(
  { "token.hash": 1 },
  { name: "uq_member_invite_token", unique: true },
);
inviteSchema.index(
  { weddingId: 1, status: 1, createdAt: -1 },
  { name: "ix_member_invites" },
);
export type MemberInvitationRecord = InferSchemaType<typeof inviteSchema>;
export const MemberInvitation: Model<MemberInvitationRecord> =
  (mongoose.models.MemberInvitation as
    Model<MemberInvitationRecord> | undefined) ??
  mongoose.model<MemberInvitationRecord>("MemberInvitation", inviteSchema);
