import "server-only";
import mongoose, { Schema, type Model, type InferSchemaType } from "mongoose";
import {
  connectDatabase,
  commonFields,
  modelOptions,
} from "@/lib/db/connection";
import { verifyCollectionContract } from "@/lib/db/verify-contract";
import { tokenEnvelopeSchema } from "@/lib/security/token-envelope";
import { AppError } from "@/lib/http/errors";
const ref = { type: Schema.Types.ObjectId, required: true } as const;
const guestSchema = new Schema(
  {
    ...commonFields,
    weddingId: ref,
    name: { type: String, required: true },
    emailNormalized: String,
    phone: String,
    contactRevision: { type: Number, required: true, default: 0 },
    isDeleted: { type: Boolean, required: true, default: false },
    createdBy: ref,
    updatedBy: ref,
    deletedBy: Schema.Types.ObjectId,
    deletedAt: Date,
  },
  modelOptions("guests"),
);
guestSchema.index(
  { weddingId: 1, emailNormalized: 1 },
  {
    name: "uq_active_guest_email",
    unique: true,
    partialFilterExpression: {
      isDeleted: false,
      emailNormalized: { $type: "string" },
    },
  },
);
guestSchema.index(
  { weddingId: 1, name: 1, _id: 1 },
  {
    name: "ix_active_guest_list",
    partialFilterExpression: { isDeleted: false },
  },
);
const invitationSchema = new Schema(
  {
    ...commonFields,
    weddingId: ref,
    eventId: ref,
    guestId: ref,
    createdBy: ref,
    status: {
      type: String,
      required: true,
      enum: ["active", "revoked"],
      default: "active",
    },
    rsvp: {
      type: String,
      required: true,
      enum: ["pending", "attending", "declined"],
      default: "pending",
    },
    respondedAt: Date,
    revokedReason: String,
    revokedAt: Date,
    revokedBy: Schema.Types.ObjectId,
    guestContactRevision: { type: Number, required: true },
    token: { type: tokenEnvelopeSchema, required: true },
  },
  modelOptions("eventInvitations"),
);
invitationSchema.index(
  { weddingId: 1, guestId: 1, eventId: 1 },
  { unique: true, name: "uq_guest_event" },
);
invitationSchema.index(
  { "token.hash": 1 },
  { unique: true, name: "uq_rsvp_token" },
);
invitationSchema.index(
  { weddingId: 1, eventId: 1, status: 1, rsvp: 1, _id: 1 },
  { name: "ix_event_rsvp" },
);
export type GuestRecord = InferSchemaType<typeof guestSchema>;
export type InvitationRecord = InferSchemaType<typeof invitationSchema>;
export const Guest: Model<GuestRecord> =
  mongoose.models.Guest ?? mongoose.model("Guest", guestSchema);
export const Invitation: Model<InvitationRecord> =
  mongoose.models.EventInvitation ??
  mongoose.model("EventInvitation", invitationSchema);
const id = { bsonType: "objectId" },
  date = { bsonType: "date" },
  int = { bsonType: ["int", "long", "double"], minimum: 0, multipleOf: 1 },
  string = { bsonType: "string" };
const common = {
  weddingId: id,
  createdBy: id,
  createdAt: date,
  updatedAt: date,
  schemaVersion: int,
  version: int,
};
function contract(
  required: Record<string, unknown>,
  optional: Record<string, unknown>,
) {
  return {
    $jsonSchema: {
      bsonType: "object",
      required: Object.keys({ ...common, ...required }),
      properties: { ...common, ...required, ...optional },
    },
  };
}
const configs = [
  {
    model: Guest,
    validator: contract(
      {
        name: { ...string, minLength: 1, maxLength: 150 },
        updatedBy: id,
        isDeleted: { bsonType: "bool" },
        contactRevision: int,
      },
      {
        emailNormalized: { ...string, maxLength: 254 },
        phone: { ...string, maxLength: 32 },
        deletedBy: id,
        deletedAt: date,
      },
    ),
  },
  {
    model: Invitation,
    validator: contract(
      {
        guestId: id,
        eventId: id,
        status: { enum: ["active", "revoked"] },
        rsvp: { enum: ["pending", "attending", "declined"] },
        guestContactRevision: int,
        token: {
          bsonType: "object",
          required: [
            "hash",
            "version",
            "ciphertext",
            "keyId",
            "nonce",
            "tag",
            "issuedAt",
          ],
          properties: {
            hash: string,
            version: int,
            ciphertext: string,
            keyId: string,
            nonce: string,
            tag: string,
            issuedAt: date,
          },
        },
      },
      {
        revokedReason: { enum: ["guestDeleted", "eventDeleted", "uninvited"] },
        revokedAt: date,
        revokedBy: id,
        respondedAt: date,
      },
    ),
  },
];
async function verify() {
  for (const { model, validator } of configs)
    await verifyCollectionContract(
      model.collection.name,
      validator,
      model.schema.indexes().map(([key, opt]) => ({
        name: opt.name!,
        key,
        unique: !!opt.unique,
        partialFilterExpression: opt.partialFilterExpression,
      })),
    );
}
export async function migrateGuests() {
  await connectDatabase();
  for (const { model, validator } of configs) {
    await model.createCollection();
    await model.createIndexes();
    await mongoose.connection.db!.command({
      collMod: model.collection.name,
      validator,
      validationLevel: "strict",
      validationAction: "error",
    });
  }
  await verify();
}
let checked: ReturnType<typeof mongoose.connection.getClient> | undefined;
export async function ensureGuests() {
  await connectDatabase();
  const client = mongoose.connection.getClient();
  if (client === checked) return;
  try {
    await verify();
    checked = client;
  } catch {
    throw new AppError(
      503,
      "SERVICE_NOT_CONFIGURED",
      "The guest directory is temporarily unavailable.",
    );
  }
}
