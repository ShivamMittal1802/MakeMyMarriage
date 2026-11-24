"use client";

import Link from "next/link";
import { signIn, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import {
  acknowledgement,
  emailRequestSchema,
  loginSchema,
  registrationSchema,
  resetSchema,
  verificationSchema,
} from "../schemas";
import styles from "./auth.module.css";

type Action =
  | "login"
  | "register"
  | "verify-email"
  | "resend-verification"
  | "forgot-password"
  | "reset-password";
const buttons: Record<Action, string> = {
  login: "Log in",
  register: "Create account",
  "verify-email": "Verify my email",
  "resend-verification": "Send verification email",
  "forgot-password": "Send reset link",
  "reset-password": "Save new password",
};

async function identityRequest(
  action: Exclude<Action, "login">,
  body: unknown,
) {
  const bootstrap = await fetch("/api/v1/csrf", { cache: "no-store" });
  const csrf = await bootstrap.json();
  if (!bootstrap.ok)
    throw new Error(
      csrf.error?.message ||
        "Account access is unavailable. Please try again later.",
    );
  const response = await fetch(`/api/v1/identity/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf.data.csrfToken,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error?.message || "Something went wrong. Please try again.",
    );
}

function PasswordField({
  name,
  label,
  confirm = false,
  login = false,
}: {
  name: string;
  label: string;
  confirm?: boolean;
  login?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={id}>{label}</label>
        {login && <Link href="/forgot-password">Forgot password?</Link>}
      </div>
      <div className={styles.password}>
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={login ? "current-password" : "new-password"}
          required
          minLength={login ? 1 : 12}
          maxLength={128}
          aria-describedby={!login && !confirm ? `${id}-hint` : undefined}
        />
        <button
          type="button"
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {!login && !confirm && (
        <small id={`${id}-hint`}>
          Use 12–128 characters. Spaces are welcome.
        </small>
      )}
    </div>
  );
}

export function AuthForm({
  action,
  configured,
  email,
}: {
  action: Action;
  configured: boolean;
  email?: string;
}) {
  const router = useRouter();
  const id = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);
  // The fragment is never sent to the page server. Keep it only in component memory.
  const [token] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.hash.slice(1)).get("token") ?? ""),
  );
  useEffect(() => {
    if (
      (action === "verify-email" || action === "reset-password") &&
      window.location.hash
    )
      window.history.replaceState(null, "", window.location.pathname);
  }, [action]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !configured) return;
    setPending(true);
    setError("");
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const fields = {
        email: email ?? data.get("email"),
        password: data.get("password"),
      };
      if (action === "login") {
        const parsed = loginSchema.safeParse(fields);
        if (!parsed.success) throw new Error(parsed.error.issues[0].message);
        const result = await signIn("credentials", {
          ...parsed.data,
          redirect: false,
          redirectTo: "/onboarding",
        });
        if (result.error)
          throw new Error(
            result.code === "rate_limited"
              ? "Too many attempts. Please try again later."
              : result.code === "unavailable"
                ? "Account access is unavailable. Please try again later."
                : "The email or password is incorrect.",
          );
        router.replace("/onboarding");
        router.refresh();
        return;
      }
      let body: unknown;
      if (action === "register") {
        if (fields.password !== data.get("confirmPassword"))
          throw new Error("Your passwords don’t match.");
        const parsed = registrationSchema.safeParse({
          ...fields,
          name: data.get("name"),
        });
        if (!parsed.success) throw new Error(parsed.error.issues[0].message);
        body = parsed.data;
      } else if (action === "reset-password") {
        if (data.get("password") !== data.get("confirmPassword"))
          throw new Error("Your passwords don’t match.");
        const parsed = resetSchema.safeParse({
          token,
          newPassword: data.get("password"),
        });
        if (!parsed.success) throw new Error(parsed.error.issues[0].message);
        body = parsed.data;
      } else if (action === "verify-email") {
        const parsed = verificationSchema.safeParse({ token });
        if (!parsed.success)
          throw new Error(
            "This link is invalid or incomplete. Request a new one below.",
          );
        body = parsed.data;
      } else {
        const parsed = emailRequestSchema.safeParse({ email: fields.email });
        if (!parsed.success) throw new Error("Enter a valid email address.");
        body = parsed.data;
      }
      await identityRequest(action, body);
      setMessage(
        action === "verify-email"
          ? "Your email is verified. You can continue to your account."
          : action === "reset-password"
            ? "Your password has been changed. Log in with your new password."
            : acknowledgement,
      );
      if (
        action === "reset-password" ||
        action === "verify-email" ||
        action === "register"
      )
        setComplete(true);
      form.reset();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to connect. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  const hasEmail =
    !email && action !== "verify-email" && action !== "reset-password";
  const hasPassword =
    action === "login" || action === "register" || action === "reset-password";
  return (
    <>
      {!configured && (
        <p className={styles.notice} role="status">
          You can fill in your details, but account services aren’t configured
          yet. Submission is temporarily unavailable.
        </p>
      )}
      <form onSubmit={submit} className={styles.form} aria-busy={pending}>
        <fieldset disabled={pending || complete}>
          {action === "register" && (
            <div className={styles.field}>
              <label htmlFor={`${id}-name`}>Your name</label>
              <input
                id={`${id}-name`}
                name="name"
                autoComplete="name"
                required
                maxLength={150}
              />
            </div>
          )}
          {hasEmail && (
            <div className={styles.field}>
              <label htmlFor={`${id}-email`}>Email address</label>
              <input
                id={`${id}-email`}
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </div>
          )}
          {hasPassword && (
            <PasswordField
              name="password"
              label={action === "reset-password" ? "New password" : "Password"}
              login={action === "login"}
            />
          )}
          {(action === "register" || action === "reset-password") && (
            <PasswordField
              name="confirmPassword"
              label="Confirm password"
              confirm
            />
          )}
          {!complete && (
            <button
              className={styles.primary}
              type="submit"
              disabled={!configured}
            >
              {pending ? "Please wait…" : buttons[action]}
            </button>
          )}
        </fieldset>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className={styles.notice} role="status">
            {message}
          </p>
        )}
      </form>
      <div className={styles.links}>
        {action === "login" && (
          <p>
            New to Make My Marriage?{" "}
            <Link href="/register">Create an account</Link>
          </p>
        )}
        {action === "register" && (
          <>
            <p>
              Already have an account? <Link href="/login">Log in</Link>
            </p>
            {complete && (
              <Link href="/resend-verification">
                Request a fresh verification link
              </Link>
            )}
          </>
        )}
        {action === "verify-email" && (
          <>
            <Link href="/onboarding">Continue to your account</Link>
            <Link href="/resend-verification">
              Request a new verification link
            </Link>
          </>
        )}
        {(action === "forgot-password" ||
          action === "reset-password" ||
          action === "resend-verification") && (
          <Link href="/login">Back to log in</Link>
        )}
        {action === "reset-password" && (
          <Link href="/forgot-password">Request a new reset link</Link>
        )}
      </div>
    </>
  );
}

export function SignOutButton() {
  return (
    <button
      className={styles.primary}
      onClick={() => void signOut({ redirectTo: "/" })}
    >
      Log out
    </button>
  );
}
