import "server-only";
import type { IdentityPurpose } from "@/modules/identity/schemas";
import type { IdentityEmailPayload } from "@/lib/providers/resend";

export function identityEmail(
  purpose: IdentityPurpose,
  link: string,
  from: string,
  to: string,
  test: boolean,
): IdentityEmailPayload {
  const verify = purpose === "verifyEmail";
  const title = verify ? "Verify your email" : "Reset your password";
  const instruction = verify
    ? "Confirm your email to get ready to create or join your wedding."
    : "Choose a new password for your Make My Marriage account.";
  const expiry = verify ? "24 hours" : "30 minutes";
  const subject = `${test ? "[TEST] " : ""}${title} — Make My Marriage`;
  return {
    from,
    to,
    subject,
    templateVersion: 1,
    text: `${title}\n\n${instruction}\n\n${link}\n\nThis link expires in ${expiry} and can be used once. If you did not request it, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;color:#2b2025;max-width:560px;margin:auto;padding:32px"><p style="color:#681c35">Make My Marriage</p><h1>${title}</h1><p>${instruction}</p><p><a href="${link}" style="display:inline-block;background:#681c35;color:white;padding:14px 22px;border-radius:8px;text-decoration:none">${title}</a></p><p>This link expires in ${expiry} and can be used once.</p><p>If you did not request it, you can ignore this email.</p></div>`,
  };
}
