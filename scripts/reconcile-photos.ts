import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { reconcilePhotos } from "../src/modules/gallery/service";
async function main() {
  loadEnvConfig(process.cwd());
  try {
    console.log(`Checked ${await reconcilePhotos()} photo cleanup candidates.`);
  } catch {
    console.error(
      "Photo cleanup could not finish. Check storage configuration and retry.",
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
void main();
