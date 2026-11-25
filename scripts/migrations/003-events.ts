import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { migrateEvents } from "../../src/modules/events/model";
async function main() {
  loadEnvConfig(process.cwd());
  try {
    await migrateEvents();
    console.log("Event migration 003 applied");
  } catch {
    console.error(
      "Event migration failed. Check database connectivity and migration permissions.",
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
void main();
