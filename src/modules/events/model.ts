import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import {
  commonFields,
  modelOptions,
  connectDatabase,
} from "@/lib/db/connection";
import { verifyCollectionContract } from "@/lib/db/verify-contract";
import { AppError } from "@/lib/http/errors";
const reference = { type: Schema.Types.ObjectId, required: true };
const schema = new Schema(
  {
    ...commonFields,
    weddingId: reference,
    name: { type: String, required: true, maxlength: 150 },
    location: { type: String, required: true, maxlength: 500 },
    description: { type: String, maxlength: 5000 },
    startsAt: { type: Date, required: true },
    endsAt: Date,
    createdBy: reference,
    updatedBy: reference,
    isDeleted: { type: Boolean, default: false, required: true },
    deletedAt: Date,
    deletedBy: Schema.Types.ObjectId,
  },
  modelOptions("events"),
);
const index = {
  name: "ix_active_event_schedule",
  key: { weddingId: 1, startsAt: 1, _id: 1 } as const,
  partialFilterExpression: { isDeleted: false },
};
schema.index(index.key, {
  name: index.name,
  partialFilterExpression: index.partialFilterExpression,
});
export type EventRecord = InferSchemaType<typeof schema>;
export const WeddingEvent: Model<EventRecord> =
  mongoose.models.WeddingEvent ?? mongoose.model("WeddingEvent", schema);
const date = { bsonType: "date" },
  id = { bsonType: "objectId" },
  integer = { bsonType: ["int", "long", "double"], minimum: 0, multipleOf: 1 };
const validator = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "weddingId",
      "name",
      "location",
      "startsAt",
      "createdBy",
      "updatedBy",
      "isDeleted",
      "version",
      "schemaVersion",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      weddingId: id,
      createdBy: id,
      updatedBy: id,
      deletedBy: id,
      startsAt: date,
      endsAt: date,
      deletedAt: date,
      createdAt: date,
      updatedAt: date,
      version: integer,
      schemaVersion: integer,
      isDeleted: { bsonType: "bool" },
      name: { bsonType: "string", minLength: 1, maxLength: 150 },
      location: { bsonType: "string", minLength: 1, maxLength: 500 },
      description: { bsonType: "string", maxLength: 5000 },
    },
  },
};
export async function migrateEvents() {
  await connectDatabase();
  await WeddingEvent.createCollection();
  await WeddingEvent.createIndexes();
  await mongoose.connection.db!.command({
    collMod: "events",
    validator,
    validationLevel: "strict",
    validationAction: "error",
  });
  await verifyCollectionContract("events", validator, [index]);
}
let verifiedClient:
  ReturnType<typeof mongoose.connection.getClient> | undefined;
export async function ensureEvents() {
  await connectDatabase();
  const client = mongoose.connection.getClient();
  if (verifiedClient === client) return;
  try {
    await verifyCollectionContract("events", validator, [index]);
    verifiedClient = client;
  } catch {
    throw new AppError(
      503,
      "SERVICE_NOT_CONFIGURED",
      "The event schedule is temporarily unavailable.",
    );
  }
}
