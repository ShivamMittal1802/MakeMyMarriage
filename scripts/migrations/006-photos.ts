import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { connectDatabase } from "../../src/lib/db/connection";
import { identityValidators } from "../../src/lib/db/identity-contract";
import {
  Photo,
  photoValidator,
  ensurePhotos,
} from "../../src/modules/gallery/model";
async function main() {
  loadEnvConfig(process.cwd());
  try {
    await connectDatabase();
    await Photo.createCollection();
    await Photo.createIndexes();
    for (const [collMod, validator] of [
      ["photos", photoValidator],
      ["usage", identityValidators.usage],
    ] as const)
      await mongoose.connection.db!.command({
        collMod,
        validator,
        validationLevel: "strict",
        validationAction: "error",
      });
    await ensurePhotos();
    console.log("Photo migration 006 applied");
  } catch {
    console.error(
      "Photo migration failed. Check database connectivity and migration permissions.",
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
void main();
