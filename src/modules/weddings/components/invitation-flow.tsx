"use client";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/landing/landing-icons";
import { ApiClientError, postJson } from "@/lib/http/client";
import type { InviteContext } from "../schemas";
import { roleLabels } from "../format";
import styles from "./onboarding.module.css";

export function InvitationExchange() {
  const router = useRouter();
  const [token] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.hash.slice(1)).get("token") ?? ""),
  );
  const [error, setError] = useState("");
  const attempt = useRef<Promise<InviteContext> | null>(null);
  useEffect(() => {
    if (window.location.hash)
      window.history.replaceState(null, "", window.location.pathname);
    let active = true;
    attempt.current ??= token
      ? postJson<InviteContext>("/api/v1/access/member-invitation", { token })
      : Promise.reject(
          new Error(
            "Open the private invitation link shared with you to join a wedding.",
          ),
        );
    void attempt.current
      .then((context) => {
        if (active) router.replace(context.cleanPath);
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "This invitation is unavailable.",
          );
      });
    return () => {
      active = false;
    };
  }, [token, router]);
  return (
    <section className={styles.centerCard}>
      <span className={styles.emblem}>
        <Icon name="mail" />
      </span>
      <h1>
        {error
          ? "Your invitation starts with a link."
          : "Opening your invitation…"}
      </h1>
      <p role="status">
        {error ||
          "A moment while we check your private invitation. You’ll choose whether to accept."}
      </p>
      <div className={styles.stackedActions}>
        <Link className={styles.primary} href="/onboarding?skipInvitation=1">
          Back to your account
        </Link>
      </div>
      <p className={styles.small}>
        Wedding management invitations are separate from guest RSVP and photo
        links.
      </p>
    </section>
  );
}
export function JoinInvitation({
  context,
  mode,
  weddingId,
}: {
  context: InviteContext;
  mode:
    | "logged-out"
    | "verify"
    | "wrong-email"
    | "existing-member"
    | "eligible"
    | "accepted";
  weddingId?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(mode === "accepted");
  const router = useRouter();
  async function accept() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await postJson(
        `/api/v1/member-invitations/${context.invitationId}/accept`,
        {},
      );
      setJoined(true);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Please try again.",
      );
      if (
        failure instanceof ApiClientError &&
        [
          "AUTHENTICATION_REQUIRED",
          "EMAIL_VERIFICATION_REQUIRED",
          "INVITATION_EMAIL_MISMATCH",
          "ACTIVE_MEMBERSHIP_EXISTS",
        ].includes(failure.code)
      )
        router.refresh();
    } finally {
      setPending(false);
    }
  }
  return (
    <section className={styles.centerCard}>
      <span className={styles.emblem}>
        <Icon name={joined ? "check" : "people"} />
      </span>
      <h1>
        {joined
          ? "You’re part of the celebration."
          : "A little help. A lot of love."}
      </h1>
      <p>
        {joined
          ? "You’ve joined the wedding’s planning team."
          : "You’ve been invited to help bring their celebration together."}
      </p>
      <div className={styles.invitePanel}>
        <span className={styles.badge}>Planning team invitation</span>
        <h2>
          {context.couple.brideName}
          <br />
          &amp; {context.couple.groomName}
        </h2>
        <p>
          Your role: <strong>{roleLabels[context.role]}</strong>
        </p>
        <p className={styles.small}>
          Expires{" "}
          {new Intl.DateTimeFormat("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "Asia/Kolkata",
          }).format(new Date(context.expiresAt))}
        </p>
      </div>
      {joined ? (
        <Link
          className={styles.primary}
          href={weddingId ? `/dashboard/${weddingId}` : "/onboarding"}
        >
          Go to my wedding
        </Link>
      ) : (
        <>
          {mode === "eligible" && (
            <>
              <p>
                Accepting gives you management access to this wedding’s events,
                guests, and shared planning details.
              </p>
              <div className={styles.stackedActions}>
                <button
                  className={styles.primary}
                  disabled={pending}
                  onClick={() => void accept()}
                >
                  {pending ? "Joining the planning team…" : "Accept invitation"}
                </button>
                <Link
                  className={styles.textButton}
                  href="/onboarding?skipInvitation=1"
                >
                  Not now
                </Link>
              </div>
            </>
          )}
          {mode === "logged-out" && (
            <>
              <p>
                Log in with the email address that received this invitation.
              </p>
              <div className={styles.stackedActions}>
                <Link className={styles.primary} href="/login">
                  Log in to continue
                </Link>
                <Link className={styles.secondary} href="/register">
                  Create an account
                </Link>
              </div>
            </>
          )}
          {mode === "verify" && (
            <>
              <p>Verify your email before accepting this invitation.</p>
              <Link className={styles.primary} href="/onboarding">
                Verify my email
              </Link>
            </>
          )}
          {mode === "wrong-email" && (
            <>
              <p className={styles.notice}>
                Sign in with the email address that received this invitation.
              </p>
              <button
                className={styles.primary}
                onClick={() => void signOut({ redirectTo: "/onboarding" })}
              >
                Use another account
              </button>
            </>
          )}
          {mode === "existing-member" && (
            <>
              <p className={styles.notice}>
                You already belong to a wedding. An account can have one active
                wedding membership at a time.
              </p>
              <Link
                className={styles.primary}
                href={weddingId ? `/dashboard/${weddingId}` : "/onboarding"}
              >
                Open my existing wedding
              </Link>
            </>
          )}
        </>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <p className={styles.small}>
        Guests don’t need a management account to RSVP or share photos.
      </p>
    </section>
  );
}
