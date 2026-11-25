import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { migrateExpenses } from "../../src/modules/expenses/model";
async function main() {
  loadEnvConfig(process.cwd());
  try {
    await migrateExpenses();
    console.log("Expense migration 005 applied");
  } catch {
    console.error(
      "Expense migration failed. Check database connectivity and migration permissions.",
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
void main();
