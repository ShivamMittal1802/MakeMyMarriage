import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { reconcileIdentityEmail } from "../src/modules/email/identity-delivery";
async function main() {
  loadEnvConfig(process.cwd());
  try {
    console.log(
      "Interrupted identity jobs reconciled:",
      await reconcileIdentityEmail(),
    );
  } catch {
    console.error(
      "Reconciliation failed. Check database configuration and migration. No secrets displayed.",
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
void main();
