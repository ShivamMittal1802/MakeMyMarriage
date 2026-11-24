import "server-only";
import { appOrigin, databaseConfig } from "@/lib/config/server";

export function developmentEmailVerificationEnabled() {
  if (
    process.env.DEV_SKIP_EMAIL_VERIFICATION !== "true" ||
    process.env.NODE_ENV !== "development" ||
    process.env.VERCEL ||
    (process.env.EMAIL_MODE ?? "simulated") !== "simulated"
  )
    return false;
  try {
    return (
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(appOrigin()).hostname,
      ) && /_(dev|test)$/.test(databaseConfig().name)
    );
  } catch {
    return false;
  }
}

// This is an access decision, not proof of inbox ownership. Keeping the stored
// timestamp unchanged makes disabling the local development exception reversible.
export function emailVerificationSatisfied(account: {
  emailVerifiedAt?: Date | null;
}) {
  return !!account.emailVerifiedAt || developmentEmailVerificationEnabled();
}
