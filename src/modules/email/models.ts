import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { commonFields, modelOptions } from "@/lib/db/connection";

export const emailKinds = [
  "guestInvitation",
  "guestReminder",
  "memberInvitation",
  "verifyEmail",
  "resetPassword",
] as const;
export const jobStates = [
  "pending",
  "processing",
  "accepted",
  "deferredQuota",
  "retryableFailed",
  "permanentlyFailed",
  "needsReview",
  "cancelled",
  "simulated",
] as const;
const modes = ["simulated", "test", "live"];
const operationSchema = new Schema(
  {
    ...commonFields,
    scopeKey: { type: String, required: true },
    weddingId: Schema.Types.ObjectId,
    initiatedByUserId: Schema.Types.ObjectId,
    kind: { type: String, enum: emailKinds, required: true },
    mode: { type: String, enum: modes, required: true },
    requestKey: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: {
      type: String,
      enum: ["preparing", "open", "closed", "cancelled"],
      required: true,
    },
    expectedJobs: { type: Number, required: true, min: 1 },
  },
  modelOptions("emailOperations"),
);
operationSchema.index(
  { scopeKey: 1, requestKey: 1 },
  { name: "uq_email_operation_request", unique: true },
);
type OperationRecord = InferSchemaType<typeof operationSchema>;
export const EmailOperation: Model<OperationRecord> =
  (mongoose.models.EmailOperation as Model<OperationRecord> | undefined) ??
  mongoose.model<OperationRecord>("EmailOperation", operationSchema);

const cipherSchema = new Schema(
  {
    ciphertext: { type: String, required: true },
    keyId: { type: String, required: true },
    nonce: { type: String, required: true },
    tag: { type: String, required: true },
  },
  { _id: false },
);
const leaseSchema = new Schema(
  {
    id: { type: String, required: true },
    until: { type: Date, required: true },
  },
  { _id: false },
);
const quotaSchema = new Schema(
  {
    dayId: { type: String, required: true },
    monthId: { type: String, required: true },
    state: {
      type: String,
      enum: ["reserved", "consumed", "held", "released"],
      required: true,
    },
  },
  { _id: false },
);
const jobSchema = new Schema(
  {
    ...commonFields,
    operationId: { type: Schema.Types.ObjectId, required: true },
    scopeKey: { type: String, required: true },
    weddingId: Schema.Types.ObjectId,
    contactRevision: { type: Number, min: 0 },
    subjectType: {
      type: String,
      enum: ["authToken", "memberInvitation", "eventInvitation"],
      required: true,
    },
    subjectId: { type: Schema.Types.ObjectId, required: true },
    subjectKey: { type: String, required: true },
    intendedRecipient: { type: String, required: true },
    actualRecipient: { type: String, required: true },
    mode: { type: String, enum: modes, required: true },
    kind: { type: String, enum: emailKinds, required: true },
    payloadCipher: { type: cipherSchema, required: true, select: false },
    payloadHash: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
    state: {
      type: String,
      enum: jobStates,
      default: "pending",
      required: true,
    },
    attemptCount: { type: Number, default: 0, required: true },
    lease: { type: leaseSchema },
    quota: { type: quotaSchema },
    dispatchStartedAt: Date,
    firstAttemptAt: Date,
    providerMessageId: String,
    acceptedAt: Date,
    retryNotBefore: Date,
    cancelRequestedAt: Date,
    cancelReason: String,
    lastErrorCode: String,
  },
  modelOptions("emailJobs"),
);
jobSchema.index(
  { operationId: 1, subjectKey: 1 },
  { name: "uq_operation_subject", unique: true },
);
jobSchema.index(
  { idempotencyKey: 1 },
  { name: "uq_send_idempotency", unique: true },
);
jobSchema.index(
  { operationId: 1, state: 1, createdAt: 1, _id: 1 },
  { name: "ix_operation_jobs" },
);
jobSchema.index(
  { subjectType: 1, subjectId: 1, mode: 1, acceptedAt: -1 },
  { name: "ix_subject_send_history" },
);
jobSchema.index(
  { state: 1, "quota.dayId": 1, acceptedAt: 1 },
  { name: "ix_email_day_carry" },
);
jobSchema.index(
  { state: 1, "quota.monthId": 1, acceptedAt: 1 },
  { name: "ix_email_month_carry" },
);
export type EmailJobRecord = InferSchemaType<typeof jobSchema>;
export const EmailJob: Model<EmailJobRecord> =
  (mongoose.models.EmailJob as Model<EmailJobRecord> | undefined) ??
  mongoose.model<EmailJobRecord>("EmailJob", jobSchema);

const attemptSchema = new Schema(
  {
    ...commonFields,
    jobId: { type: Schema.Types.ObjectId, required: true },
    operationId: { type: Schema.Types.ObjectId, required: true },
    attemptNo: { type: Number, required: true },
    leaseId: { type: String, required: true },
    startedAt: { type: Date, required: true },
    finishedAt: Date,
    outcome: {
      type: String,
      enum: ["started", "accepted", "rejected", "unknown"],
      required: true,
    },
    providerMessageId: String,
    errorCode: String,
  },
  modelOptions("emailAttempts"),
);
attemptSchema.index(
  { jobId: 1, attemptNo: 1 },
  { name: "uq_job_attempt", unique: true },
);
type AttemptRecord = InferSchemaType<typeof attemptSchema>;
export const EmailAttempt: Model<AttemptRecord> =
  (mongoose.models.EmailAttempt as Model<AttemptRecord> | undefined) ??
  mongoose.model<AttemptRecord>("EmailAttempt", attemptSchema);

const usageSchema = new Schema(
  {
    ...commonFields,
    _id: { type: String, required: true },
    kind: { type: String, enum: ["emailDay", "emailMonth"], required: true },
    windowStart: { type: Date, required: true },
    windowEnd: { type: Date, required: true },
    limit: { type: Number, required: true, min: 1 },
    consumed: { type: Number, required: true, default: 0, min: 0 },
    reserved: { type: Number, required: true, default: 0, min: 0 },
    held: { type: Number, required: true, default: 0, min: 0 },
    // Portion of held capacity attributable to dispatches from older windows.
    carryHeld: { type: Number, default: 0, min: 0 },
  },
  modelOptions("usage"),
);
type UsageRecord = InferSchemaType<typeof usageSchema>;
export const Usage: Model<UsageRecord> =
  (mongoose.models.EmailUsage as Model<UsageRecord> | undefined) ??
  mongoose.model<UsageRecord>("EmailUsage", usageSchema);
