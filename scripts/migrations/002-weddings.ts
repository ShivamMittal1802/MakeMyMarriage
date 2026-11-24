import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { migrateWeddings } from "../../src/lib/db/migrate-weddings";
async function main() {
  loadEnvConfig(process.cwd());
  try {
    console.log(
      "Wedding migration 002 applied:",
      (await migrateWeddings()).join(", "),
    );
  } catch {
    console.error(
      "Wedding migration failed. Check identity migration, database permissions, existing duplicate records, and legacy permanent membership indexes. No secrets displayed.",
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
void main();
