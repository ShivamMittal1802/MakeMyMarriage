import "server-only";
import mongoose from "mongoose";
import { ensureIdentityDatabase } from "./readiness";
import { weddingModels, weddingValidators } from "./wedding-contract";
import { verifyCollectionContract } from "./verify-contract";
import { AppError } from "@/lib/http/errors";
let client: ReturnType<typeof mongoose.connection.getClient> | undefined;
let checked: Promise<void> | undefined;
export async function ensureWeddingDatabase() {
  await ensureIdentityDatabase();
  if (client !== mongoose.connection.getClient()) {
    checked = undefined;
    client = mongoose.connection.getClient();
  }
  checked ??= (async () => {
    try {
      for (const model of weddingModels)
        await verifyCollectionContract(
          model.collection.name,
          weddingValidators[model.collection.name],
          model.schema.indexes().map(([key, options]) => ({
            name: options.name!,
            key,
            unique: !!options.unique,
            partialFilterExpression: options.partialFilterExpression,
          })),
        );
    } catch {
      throw new AppError(
        503,
        "SERVICE_NOT_CONFIGURED",
        "Wedding setup is not ready yet. Please try again later.",
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
