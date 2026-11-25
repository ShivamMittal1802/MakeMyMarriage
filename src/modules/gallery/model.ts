import "server-only";
import mongoose, { Schema } from "mongoose";
import {
  commonFields,
  modelOptions,
  connectDatabase,
} from "@/lib/db/connection";
import { verifyCollectionContract } from "@/lib/db/verify-contract";
import { AppError } from "@/lib/http/errors";
import {
  identityValidators,
  identityIndexes,
} from "@/lib/db/identity-contract";
const object = new Schema(
  {
    kind: {
      type: String,
      enum: ["staging", "original", "preview"],
      required: true,
    },
    key: { type: String, required: true },
    bytes: { type: Number, required: true },
    etag: String,
    state: {
      type: String,
      enum: ["reserved", "present", "deletePending", "deleted"],
      required: true,
    },
  },
  { _id: false },
);
const schema = new Schema(
  {
    ...commonFields,
    weddingId: { type: Schema.Types.ObjectId, required: true },
    clientUploadKey: { type: String, required: true },
    uploadAccessId: Schema.Types.ObjectId,
    uploadAccessVersion: Number,
    uploadedByUserId: Schema.Types.ObjectId,
    originalFilename: { type: String, required: true },
    declaredBytes: { type: Number, required: true },
    declaredMime: { type: String, required: true },
    state: {
      type: String,
      enum: [
        "reserved",
        "uploaded",
        "processing",
        "ready",
        "rejected",
        "deleting",
        "deleted",
      ],
      required: true,
    },
    objects: { type: [object], required: true },
    reservation: {
      bytes: { type: Number, required: true },
      expiresAt: { type: Date, required: true },
      state: { type: String, enum: ["active", "released"], required: true },
    },
    uploadUrlExpiresAt: { type: Date, required: true },
    checksumSha256: String,
    width: Number,
    height: Number,
    verifiedMime: String,
    processingLease: { id: String, until: Date },
    failureCode: String,
    deletedAt: Date,
    deletedBy: Schema.Types.ObjectId,
  },
  modelOptions("photos"),
);
schema.index(
  { weddingId: 1, clientUploadKey: 1 },
  { unique: true, name: "uq_upload_request" },
);
schema.index(
  { weddingId: 1, createdAt: -1, _id: -1 },
  { name: "ix_ready_gallery", partialFilterExpression: { state: "ready" } },
);
schema.index(
  { state: 1, "reservation.expiresAt": 1 },
  { name: "ix_photo_cleanup" },
);
export const Photo: mongoose.Model<mongoose.InferSchemaType<typeof schema>> =
  mongoose.models.WeddingPhoto ?? mongoose.model("WeddingPhoto", schema);
export type PhotoRecord = InstanceType<typeof Photo>;
const usageSchema = new Schema(
  {
    ...commonFields,
    _id: String,
    kind: { type: String, default: "storage" },
    limitBytes: Number,
    storedBytes: { type: Number, default: 0 },
    reservedBytes: { type: Number, default: 0 },
  },
  modelOptions("usage"),
);
export const StorageUsage: mongoose.Model<
  mongoose.InferSchemaType<typeof usageSchema>
> = mongoose.models.StorageUsage ?? mongoose.model("StorageUsage", usageSchema);
const integer = {
  bsonType: ["int", "long", "double"],
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
  multipleOf: 1,
};
export const photoValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "weddingId",
      "clientUploadKey",
      "originalFilename",
      "declaredBytes",
      "declaredMime",
      "state",
      "objects",
      "reservation",
      "uploadUrlExpiresAt",
      "version",
      "schemaVersion",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      weddingId: { bsonType: "objectId" },
      clientUploadKey: { bsonType: "string" },
      state: {
        enum: [
          "reserved",
          "uploaded",
          "processing",
          "ready",
          "rejected",
          "deleting",
          "deleted",
        ],
      },
      declaredBytes: { ...integer, minimum: 1, maximum: 20_000_000 },
      declaredMime: { enum: ["image/jpeg", "image/png", "image/webp"] },
      version: integer,
      objects: {
        bsonType: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          bsonType: "object",
          required: ["kind", "key", "bytes", "state"],
          properties: {
            kind: { enum: ["staging", "original", "preview"] },
            key: { bsonType: "string" },
            bytes: integer,
            state: {
              enum: ["reserved", "present", "deletePending", "deleted"],
            },
          },
        },
      },
      reservation: {
        bsonType: "object",
        required: ["bytes", "expiresAt", "state"],
        properties: {
          bytes: integer,
          expiresAt: { bsonType: "date" },
          state: { enum: ["active", "released"] },
        },
      },
    },
  },
};
export const photoIndexes = schema.indexes().map(([key, o]) => ({
  key,
  name: o.name!,
  unique: !!o.unique,
  ...(o.partialFilterExpression && {
    partialFilterExpression: o.partialFilterExpression,
  }),
}));
export async function ensurePhotos() {
  await connectDatabase();
  try {
    await verifyCollectionContract("photos", photoValidator, photoIndexes);
    await verifyCollectionContract(
      "usage",
      identityValidators.usage,
      identityIndexes.usage,
    );
  } catch {
    throw new AppError(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Photo storage needs its database migration before it can be used.",
    );
  }
}
