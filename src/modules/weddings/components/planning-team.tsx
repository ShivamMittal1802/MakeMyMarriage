"use client";
import { useState, type FormEvent } from "react";
import { postJson } from "@/lib/http/client";
import {
  memberInviteSchema,
  type InviteDto,
  type MemberRole,
} from "../schemas";
import { roleLabels } from "../format";
import styles from "./onboarding.module.css";
export function PlanningTeam({
  weddingId,
  invitations,
}: {
  weddingId: string;
  invitations: InviteDto[];
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invites, setInvites] = useState(invitations);
  const [link, setLink] = useState("");
  async function share(invite: InviteDto) {
    setPending(true);
    setError("");
    setLink("");
    setNotice("");
    try {
      const result = await postJson<{ url: string }>(
        `/api/v1/weddings/${weddingId}/member-invitations/${invite.id}/share-link`,
        {},
      );
      setLink(result.url);
      setNotice(
        `Private invitation for ${invite.email}. Share it only with the intended recipient.`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to open the invitation link.",
      );
    } finally {
      setPending(false);
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    setNotice("");
    setLink("");
    const parsed = memberInviteSchema.safeParse({
      email: data.get("email"),
      role: data.get("role"),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setPending(true);
    try {
      const invite = await postJson<InviteDto>(
        `/api/v1/weddings/${weddingId}/member-invitations`,
        parsed.data,
      );
      setInvites((previous) => [invite, ...previous].slice(0, 25));
      form.reset();
      setNotice(
        "Invitation created. No email has been sent. Use its Share link button below.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to create the invitation. Check existing invitations before retrying.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section id="planning-team" className={styles.teamSection}>
      <h2>Bring your people into the planning.</h2>
      <p>
        Create a private invitation for your partner, family, or trusted
        friends. A link stays tied to its intended email address. Only one
        person can hold each Bride or Groom role.
      </p>
      <form className={styles.teamForm} onSubmit={create}>
        <div>
          <label htmlFor="team-email">Their email address</label>
          <input
            id="team-email"
            name="email"
            type="email"
            autoComplete="off"
            required
            maxLength={254}
            disabled={pending}
          />
        </div>
        <div>
          <label htmlFor="team-role">Their role</label>
          <select
            id="team-role"
            name="role"
            defaultValue="manager"
            disabled={pending}
          >
            {(["manager", "bride", "groom"] as MemberRole[]).map((role) => (
              <option key={role} value={role}>
                {role === "manager" ? "Manager" : roleLabels[role]}
              </option>
            ))}
          </select>
        </div>
        <button className={styles.primary} disabled={pending}>
          {pending ? "Please wait…" : "Create invitation"}
        </button>
      </form>
      <p className={styles.small}>
        Creating an invitation does not send an email. Email invitation sending
        will be added separately. A Bride or Groom role is confirmed when the
        invitation is accepted.
      </p>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {link && (
        <div>
          <label className={styles.small} htmlFor="private-team-link">
            Private invitation link
          </label>
          <input
            className={styles.shareUrl}
            id="private-team-link"
            value={link}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className={styles.linkActions}>
            <button
              className={styles.secondary}
              onClick={() =>
                void navigator.clipboard
                  .writeText(link)
                  .then(() => setNotice("Private link copied."))
                  .catch(() =>
                    setError("Select and copy the private link above."),
                  )
              }
            >
              Copy private link
            </button>
            <a
              className={styles.textButton}
              href={`https://wa.me/?text=${encodeURIComponent(`You’re invited to help plan our wedding. Sign in with the email that received this invitation: ${link}`)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Share on WhatsApp
            </a>
          </div>
        </div>
      )}
      {invites.length > 0 && (
        <div className={styles.invitationList}>
          <h3>Recent pending invitations</h3>
          <p className={styles.small}>
            Showing the latest {invites.length} invitations, up to 25.
          </p>
          {invites.map((invite) => (
            <div className={styles.invitationRow} key={invite.id}>
              <div>
                <strong>{invite.email}</strong>
                <span>{roleLabels[invite.role]}</span>
              </div>
              <button
                className={styles.textButton}
                disabled={pending}
                onClick={() => void share(invite)}
              >
                Share link
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
