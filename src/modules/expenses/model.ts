import "server-only";
import mongoose, { Schema } from "mongoose";
import {
  commonFields,
  modelOptions,
  connectDatabase,
} from "@/lib/db/connection";
import { verifyCollectionContract } from "@/lib/db/verify-contract";
import { AppError } from "@/lib/http/errors";
const ref = { type: Schema.Types.ObjectId, required: true };
const schema = new Schema(
  {
    ...commonFields,
    weddingId: ref,
    title: { type: String, required: true },
    payerName: { type: String, required: true },
    vendorName: String,
    notes: String,
    expenseDate: { type: String, required: true },
    paidPaise: { type: Number, required: true, default: 0 },
    remainingPaise: { type: Number, required: true, default: 0 },
    firstPaymentDate: String,
    latestPaymentDate: String,
    remainingDueDate: String,
    createdBy: ref,
    updatedBy: ref,
    isDeleted: { type: Boolean, required: true, default: false },
    deletedAt: Date,
    deletedBy: Schema.Types.ObjectId,
  },
  modelOptions("expenses"),
);
schema.index(
  { weddingId: 1, expenseDate: -1, _id: -1 },
  {
    name: "ix_active_expense_list",
    partialFilterExpression: { isDeleted: false },
  },
);
schema.index(
  { weddingId: 1, remainingDueDate: 1, _id: 1 },
  {
    name: "ix_outstanding_due",
    partialFilterExpression: {
      isDeleted: false,
      remainingPaise: { $gt: 0 },
      remainingDueDate: { $type: "string" },
    },
  },
);
type ExpenseRecord = mongoose.InferSchemaType<typeof schema>;
export const ExpenseModel: mongoose.Model<ExpenseRecord> =
  mongoose.models.WeddingExpense ??
  mongoose.model<ExpenseRecord>("WeddingExpense", schema);
const number = {
  bsonType: ["int", "long", "double"],
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
  multipleOf: 1,
};
const validator = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "weddingId",
      "title",
      "payerName",
      "expenseDate",
      "paidPaise",
      "remainingPaise",
      "createdBy",
      "updatedBy",
      "isDeleted",
      "version",
      "schemaVersion",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      weddingId: { bsonType: "objectId" },
      title: { bsonType: "string", minLength: 1, maxLength: 150 },
      payerName: { bsonType: "string", minLength: 1, maxLength: 150 },
      expenseDate: {
        bsonType: "string",
        pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
      },
      paidPaise: number,
      remainingPaise: number,
      version: number,
      isDeleted: { bsonType: "bool" },
    },
  },
};
async function verify() {
  await verifyCollectionContract(
    "expenses",
    validator,
    schema.indexes().map(([key, o]) => ({
      key,
      name: o.name!,
      unique: false,
      partialFilterExpression: o.partialFilterExpression,
    })),
  );
}
export async function migrateExpenses() {
  await connectDatabase();
  await ExpenseModel.createCollection();
  await ExpenseModel.createIndexes();
  await mongoose.connection.db!.command({
    collMod: "expenses",
    validator,
    validationLevel: "strict",
    validationAction: "error",
  });
  await verify();
}
let checked: ReturnType<typeof mongoose.connection.getClient> | undefined;
export async function ensureExpenses() {
  await connectDatabase();
  const client = mongoose.connection.getClient();
  if (checked === client) return;
  try {
    await verify();
    checked = client;
  } catch {
    throw new AppError(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Expense tracking needs its database migration.",
    );
  }
}
