import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { migrateGuests } from "../../src/modules/guests/model";
async function main() {
  loadEnvConfig(process.cwd());
  try {
    await migrateGuests();
    console.log("Guest migration 004 applied");
  } catch {
    console.error(
      "Guest migration failed. Check database connectivity and migration permissions.",
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
void main();
