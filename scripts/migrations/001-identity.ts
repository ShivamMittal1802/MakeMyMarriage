import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { migrateIdentity } from "../../src/lib/db/migrate-identity";

async function main() {
  loadEnvConfig(process.cwd());
  try {
    const collections = await migrateIdentity();
    console.log("Identity migration 001 applied:", collections.join(", "));
  } catch {
    console.error(
      "Identity migration failed. Check database configuration, permissions, and duplicate records. No secrets displayed.",
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
void main();
