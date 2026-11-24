import "server-only";
import { Resend } from "resend";
import { emailConfig } from "@/lib/config/server";

export type IdentityEmailPayload = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  templateVersion: 1;
};
export type DeliveryResult =
  | { outcome: "accepted"; messageId: string }
  | { outcome: "rejected"; code: string; retryable: boolean }
  | { outcome: "unknown"; code: string };
export type EmailTransport = (
  payload: IdentityEmailPayload,
  idempotencyKey: string,
) => Promise<DeliveryResult>;

export const sendIdentityEmail: EmailTransport = async (
  payload,
  idempotencyKey,
) => {
  const config = emailConfig();
  if (config.mode === "simulated")
    throw new Error("Simulated messages must not reach the email provider");
  try {
    const { data, error } = await new Resend(config.apiKey).emails.send(
      {
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      },
      { idempotencyKey, signal: AbortSignal.timeout(10_000) },
    );
    if (data?.id) return { outcome: "accepted", messageId: data.id };
    const name = error?.name ?? "application_error";
    // Server/network failures can be ambiguous; never blindly replay them.
    if (
      [
        "application_error",
        "internal_server_error",
        "concurrent_idempotent_requests",
      ].includes(name) ||
      !error
    )
      return { outcome: "unknown", code: "PROVIDER_OUTCOME_UNKNOWN" };
    const quota = ["daily_quota_exceeded", "monthly_quota_exceeded"].includes(
      name,
    );
    return {
      outcome: "rejected",
      code: quota
        ? "PROVIDER_QUOTA_EXHAUSTED"
        : name === "rate_limit_exceeded"
          ? "PROVIDER_RATE_LIMITED"
          : "PROVIDER_REJECTED",
      retryable: quota || name === "rate_limit_exceeded",
    };
  } catch {
    return { outcome: "unknown", code: "PROVIDER_OUTCOME_UNKNOWN" };
  }
};
