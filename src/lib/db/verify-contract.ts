import "server-only";
import mongoose from "mongoose";
import { isDeepStrictEqual } from "node:util";

export type ExpectedIndex = {
  name: string;
  key: Record<string, unknown>;
  unique?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: Record<string, unknown>;
};
export async function verifyCollectionContract(
  collection: string,
  validator: unknown,
  expected: ExpectedIndex[],
) {
  const database = mongoose.connection.db!;
  const info = await database
    .listCollections({ name: collection }, { nameOnly: false })
    .next();
  if (
    !info ||
    !("options" in info) ||
    !isDeepStrictEqual(info.options?.validator, validator) ||
    (info.options?.validationLevel ?? "strict") !== "strict" ||
    (info.options?.validationAction ?? "error") !== "error"
  )
    throw new Error("Database validation migration incomplete");
  const indexes = await database.collection(collection).indexes();
  for (const requirement of expected) {
    const index = indexes.find((index) => index.name === requirement.name);
    if (
      !index ||
      JSON.stringify(index.key) !== JSON.stringify(requirement.key) ||
      (requirement.unique && !index.unique) ||
      (requirement.expireAfterSeconds !== undefined &&
        index.expireAfterSeconds !== requirement.expireAfterSeconds) ||
      !isDeepStrictEqual(
        index.partialFilterExpression ?? null,
        requirement.partialFilterExpression ?? null,
      )
    )
      throw new Error("Database index migration incomplete");
  }
}
