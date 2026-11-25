import "server-only";
import mongoose from "mongoose";
import { verifyCollectionContract } from "./verify-contract";
import {
  identityValidators,
  identityIndexes,
  legacyEmailUsageValidator,
} from "./identity-contract";
import { connectDatabase } from "./connection";
import { AppError } from "@/lib/http/errors";

let checked: Promise<void> | undefined;
let checkedClient: ReturnType<typeof mongoose.connection.getClient> | undefined;
export async function ensureIdentityDatabase() {
  await connectDatabase();
  const client = mongoose.connection.getClient();
  if (checkedClient !== client) {
    checked = undefined;
    checkedClient = client;
  }
  checked ??= (async () => {
    try {
      for (const [collection, expected] of Object.entries(identityIndexes)) {
        try {
          await verifyCollectionContract(
            collection,
            identityValidators[collection],
            expected,
          );
        } catch (error) {
          // Installing the gallery must not block existing sign-in before migration 006.
          // Photo readiness separately requires the extended storage contract.
          if (collection !== "usage") throw error;
          await verifyCollectionContract(
            collection,
            legacyEmailUsageValidator,
            expected,
          );
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
