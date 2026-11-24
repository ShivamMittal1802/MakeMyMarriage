"use client";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/landing/landing-icons";
import { postJson, getJson } from "@/lib/http/client";
import { acknowledgement } from "@/modules/identity/schemas";
import styles from "./onboarding.module.css";
export function AccountMenu({ email }: { email: string }) {
  return (
    <div className={styles.account}>
      <span className={styles.accountEmail}>{email}</span>
      <button
        className={styles.textButton}
        type="button"
        onClick={() => void signOut({ redirectTo: "/" })}
      >
        Log out
      </button>
      <details className={styles.accountMenu}>
        <summary aria-label="Account menu">
          <Icon name="user" />
        </summary>
        <div>
          <span>{email}</span>
          <button
            className={styles.textButton}
            onClick={() => void signOut({ redirectTo: "/onboarding" })}
          >
            Use another account
          </button>
        </div>
      </details>
    </div>
  );
}
export function VerificationRequired({
  email,
  configured,
}: {
  email: string;
  configured: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function act(resend: boolean) {
    if (pending) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      if (resend) {
        await postJson("/api/v1/identity/resend-verification", { email });
        setMessage(acknowledgement);
      } else {
        const account = await getJson<{ emailVerified: boolean }>("/api/v1/me");
        if (account.emailVerified) router.refresh();
        else
          setMessage(
            "Your email isn’t verified yet. Open your verification link, then check again.",
          );
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className={styles.centerCard}>
      <span className={styles.emblem}>
        <Icon name="mail" />
      </span>
      <h1>
        Verify your email
        <br />
        to continue.
      </h1>
      <p>
        Confirm your email before creating or joining a wedding. Check your
        inbox for your verification link.
      </p>
      <div className={styles.emailPill}>{email}</div>
      {!configured && (
        <p className={styles.notice}>
          Verification emails are not available yet. You can still check an
          existing link.
        </p>
      )}
      <div className={styles.stackedActions}>
        <button
          className={styles.primary}
          disabled={pending}
          onClick={() => void act(false)}
        >
          {pending ? "Please wait…" : "I’ve verified my email"}
        </button>
        <button
          className={styles.secondary}
          disabled={pending || !configured}
          onClick={() => void act(true)}
        >
          Resend verification email
        </button>
      </div>
      {message && (
        <p className={styles.notice} role="status">
          {message}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <p className={styles.small}>
        If you’re joining a wedding, keep your private invitation link so you
        can return to it.
      </p>
      <button
        className={styles.textButton}
        onClick={() => void signOut({ redirectTo: "/onboarding" })}
      >
        Use another account
      </button>
    </section>
  );
}
export function SetupUnavailable({
  message = "Wedding setup is temporarily unavailable. Please try again later.",
}: {
  message?: string;
}) {
  const router = useRouter();
  return (
    <section className={styles.centerCard}>
      <span className={styles.emblem}>
        <Icon name="heart" />
      </span>
      <h1>
        A little pause
        <br />
        before the planning.
      </h1>
      <p role="alert">{message}</p>
      <button className={styles.primary} onClick={() => router.refresh()}>
        Try again
      </button>
      <Link className={styles.textButton} href="/">
        Back to home
      </Link>
    </section>
  );
}
