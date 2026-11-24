import "server-only";
import mongoose from "mongoose";
import { connectDatabase } from "./connection";
import { weddingModels, weddingValidators } from "./wedding-contract";
export async function migrateWeddings() {
  await connectDatabase();
  const indexes = await mongoose.connection
    .db!.collection("memberships")
    .indexes()
    .catch((error: { code?: number }) => {
      if (error.code === 26) return [];
      throw error;
    });
  // The old permanent index blocks the approved active-only membership lifecycle.
  // Never drop user indexes automatically; require a controlled audit first.
  if (
    indexes.some(
      (index) =>
        index.unique &&
        JSON.stringify(index.key) === JSON.stringify({ userId: 1 }) &&
        !index.partialFilterExpression,
    )
  )
    throw new Error(
      "Permanent membership index requires a controlled migration",
    );
  for (const model of weddingModels) {
    await model.createCollection();
    await model.createIndexes();
  }
  for (const [collection, validator] of Object.entries(weddingValidators))
    await mongoose.connection.db!.command({
      collMod: collection,
      validator,
      validationLevel: "strict",
      validationAction: "error",
    });
  return weddingModels.map((model) => model.collection.name);
}
