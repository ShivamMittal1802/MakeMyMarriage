import "server-only";
import mongoose from "mongoose";
import { identityValidators } from "./identity-contract";
import { connectDatabase } from "./connection";
import { User, AuthToken } from "@/modules/identity/models";
import {
  EmailOperation,
  EmailJob,
  EmailAttempt,
  Usage,
} from "@/modules/email/models";
import { RateLimit } from "@/lib/security/rate-limit";

// Named, additive migration. It never drops indexes, collections, or records.
export async function migrateIdentity() {
  await connectDatabase();
  const models = [
    User,
    AuthToken,
    EmailOperation,
    EmailJob,
    EmailAttempt,
    Usage,
    RateLimit,
  ];
  for (const model of models) {
    await model.createCollection();
    await model.createIndexes();
  }
  for (const [collection, validator] of Object.entries(identityValidators)) {
    await mongoose.connection.db!.command({
      collMod: collection,
      validator,
      validationLevel: "strict",
      validationAction: "error",
    });
  }
  return models.map((model) => model.collection.name);
}
