import "server-only";
import mongoose, { type ClientSession } from "mongoose";
import { databaseConfig } from "@/lib/config/server";
import { dependencyUnavailable } from "@/lib/http/errors";

type ConnectionCache = {
  uri: string;
  name: string;
  promise: Promise<typeof mongoose>;
};
const runtime = globalThis as typeof globalThis & {
  mmmConnection?: ConnectionCache;
};

export async function connectDatabase() {
  const { uri, name } = databaseConfig();
  const cached = runtime.mmmConnection;
  if (
    !cached ||
    cached.uri !== uri ||
    cached.name !== name ||
    mongoose.connection.readyState === 0
  ) {
    runtime.mmmConnection = {
      uri,
      name,
      promise: mongoose.connect(uri, {
        dbName: name,
        maxPoolSize: 5,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 15000,
        autoIndex: false,
        autoCreate: false,
        bufferCommands: false,
      }),
    };
  }
  try {
    return await runtime.mmmConnection!.promise;
  } catch {
    delete runtime.mmmConnection;
    throw dependencyUnavailable();
  }
}

export async function transaction<T>(
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  await connectDatabase();
  return mongoose.connection.transaction(work);
}

export const commonFields = {
  schemaVersion: { type: Number, required: true, default: 1 },
  version: { type: Number, required: true, default: 0, min: 0 },
};
export const modelOptions = (collection: string) => ({
  collection,
  timestamps: true as const,
  versionKey: "version",
  autoIndex: false,
  autoCreate: false,
  bufferCommands: false as const,
});

export function duplicateKey(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === 11000
  );
}
