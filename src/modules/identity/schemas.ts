import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email())
  .transform((email) => email.toLowerCase());
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128, "Use at most 128 characters.");
export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export const registrationSchema = z.strictObject({
  name: z.string().trim().min(1, "Enter your name.").max(150),
  email: emailSchema,
  password: passwordSchema,
});
export const emailRequestSchema = z.strictObject({ email: emailSchema });
export const tokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "This link is invalid or incomplete.");
export const verificationSchema = z.strictObject({ token: tokenSchema });
export const resetSchema = z.strictObject({
  token: tokenSchema,
  newPassword: passwordSchema,
});
export type IdentityPurpose = "verifyEmail" | "resetPassword";
export const acknowledgement =
  "If this request is eligible, check your email. If nothing arrives, retry later.";
