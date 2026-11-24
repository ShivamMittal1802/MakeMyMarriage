import "server-only";
import { z } from "zod";
import { serviceNotConfigured } from "@/lib/http/errors";

const databaseSchema = z.object({
  uri: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
});

export function databaseConfig() {
  const result = databaseSchema.safeParse({
    uri: process.env.MONGODB_URI,
    name: process.env.MONGODB_DB_NAME,
  });
  if (!result.success) throw serviceNotConfigured();
  return result.data;
}

export function authSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw serviceNotConfigured();
  return value;
}

export function appOrigin() {
  try {
    const url = new URL(process.env.APP_ORIGIN ?? "http://localhost:3000");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    )
      throw new Error();
    return url.origin;
  } catch {
    throw serviceNotConfigured();
  }
}

export function encryptionConfig() {
  const encoded = process.env.TOKEN_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(encoded, "base64");
  const keyId = process.env.TOKEN_ENCRYPTION_KEY_ID;
  if (
    key.length !== 32 ||
    key.toString("base64") !== encoded ||
    !keyId ||
    keyId.length > 64
  )
    throw serviceNotConfigured();
  return { key, keyId };
}

export type EmailMode = "simulated" | "test" | "live";
export function emailConfig(now = new Date()) {
  const mode = z
    .enum(["simulated", "test", "live"])
    .safeParse(process.env.EMAIL_MODE ?? "simulated");
  if (!mode.success) throw serviceNotConfigured();
  const from =
    process.env.EMAIL_FROM || "Make My Marriage <onboarding@resend.dev>";
  if (/\r|\n/.test(from)) throw serviceNotConfigured();
  if (mode.data === "simulated")
    return {
      mode: mode.data,
      from,
      apiKey: "",
      testRecipient: "",
      namespace: "simulated",
      dailyLimit: 100,
      monthlyLimit: 3000,
      monthStart: new Date(0),
      monthEnd: new Date(0),
    };
  const parsed = z
    .object({
      apiKey: z.string().min(1),
      testRecipient: z.email().optional(),
      namespace: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
      dailyLimit: z.coerce.number().int().min(1).max(100),
      monthlyLimit: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      monthStart: z.coerce.date(),
      monthEnd: z.coerce.date(),
    })
    .safeParse({
      apiKey: process.env.RESEND_API_KEY,
      testRecipient:
        process.env.EMAIL_TEST_RECIPIENT?.trim().toLowerCase() || undefined,
      namespace: process.env.EMAIL_QUOTA_NAMESPACE,
      dailyLimit: process.env.EMAIL_DAILY_LIMIT || 100,
      monthlyLimit: process.env.EMAIL_MONTHLY_LIMIT,
      monthStart: process.env.EMAIL_MONTH_WINDOW_START,
      monthEnd: process.env.EMAIL_MONTH_WINDOW_END,
    });
  if (
    !parsed.success ||
    parsed.data.monthStart > now ||
    parsed.data.monthEnd <= now ||
    (mode.data === "test" && !parsed.data.testRecipient)
  )
    throw serviceNotConfigured();
  if (
    mode.data === "live" &&
    (!process.env.EMAIL_FROM || /@resend\.dev\b/i.test(from))
  )
    throw serviceNotConfigured();
  return {
    ...parsed.data,
    mode: mode.data,
    from,
    testRecipient: parsed.data.testRecipient ?? "",
  };
}

export function identityConfigured() {
  try {
    databaseConfig();
    authSecret();
    appOrigin();
    encryptionConfig();
    emailConfig();
    return true;
  } catch {
    return false;
  }
}

export function accountConfigured() {
  try {
    databaseConfig();
    authSecret();
    appOrigin();
    return true;
  } catch {
    return false;
  }
}
