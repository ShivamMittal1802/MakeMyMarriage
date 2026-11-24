import "server-only";
import mongoose from "mongoose";
import { isDeepStrictEqual } from "node:util";
import { identityValidators, identityIndexes } from "./identity-contract";
import { connectDatabase } from "./connection";
import { AppError } from "@/lib/http/errors";

let checked: Promise<void> | undefined;
let checkedClient: ReturnType<typeof mongoose.connection.getClient> | undefined;
export async function ensureIdentityDatabase() {
  await connectDatabase();
  const database = mongoose.connection.db!;
  const client = mongoose.connection.getClient();
  if (checkedClient !== client) {
    checked = undefined;
    checkedClient = client;
  }
  checked ??= (async () => {
    try {
      for (const [collection, expected] of Object.entries(identityIndexes)) {
        const info = await database
          .listCollections({ name: collection }, { nameOnly: false })
          .next();
        if (
          !info ||
          !("options" in info) ||
          !isDeepStrictEqual(
            info.options?.validator,
            identityValidators[collection],
          ) ||
          (info.options?.validationLevel ?? "strict") !== "strict" ||
          (info.options?.validationAction ?? "error") !== "error"
        )
          throw new Error();
        const indexes = await database.collection(collection).indexes();
        for (const requirement of expected) {
          const index = indexes.find(
            (index) => index.name === requirement.name,
          );
          // Compound-index field order is part of its definition.
          if (
            !index ||
            JSON.stringify(index.key) !== JSON.stringify(requirement.key) ||
            (requirement.unique && !index.unique) ||
            (requirement.expireAfterSeconds !== undefined &&
              index.expireAfterSeconds !== requirement.expireAfterSeconds)
          )
            throw new Error();
        }
      }
    } catch {
      throw new AppError(
        503,
        "SERVICE_NOT_CONFIGURED",
        "Account access is not ready yet. Please try again later.",
      );
    }
  })();
  try {
    await checked;
  } catch (error) {
    checked = undefined;
    throw error;
  }
}
