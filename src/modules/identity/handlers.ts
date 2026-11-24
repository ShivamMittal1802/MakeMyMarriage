import "server-only";
import type { NextRequest } from "next/server";
import { api, readJson, success } from "@/lib/http/api";
import { assertCsrf } from "@/lib/security/csrf";
import { consumeRateLimit, requestNetworkKey } from "@/lib/security/rate-limit";
import {
  acknowledgement,
  registrationSchema,
  emailRequestSchema,
  verificationSchema,
  resetSchema,
} from "./schemas";
import {
  registerAccount,
  requestChallenge,
  verifyEmail,
  resetPassword,
} from "./service";

type Action =
  | "register"
  | "verify-email"
  | "resend-verification"
  | "forgot-password"
  | "reset-password";
export function identityHandler(action: Action) {
  return async (request: NextRequest) =>
    api(async () => {
      assertCsrf(request);
      await consumeRateLimit(
        `identity-network-${action}`,
        requestNetworkKey(request),
        30,
        15 * 60_000,
      );
      if (action === "register") {
        await registerAccount(await readJson(request, registrationSchema));
      } else if (action === "verify-email") {
        await verifyEmail(await readJson(request, verificationSchema));
        return success({ verified: true });
      } else if (action === "reset-password") {
        await resetPassword(await readJson(request, resetSchema));
        return success({ passwordReset: true, signInRequired: true });
      } else {
        await requestChallenge(
          await readJson(request, emailRequestSchema),
          action === "resend-verification" ? "verifyEmail" : "resetPassword",
        );
      }
      return success({ message: acknowledgement }, 202);
    });
}
