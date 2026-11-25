"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getJson, getResponse, mutateJson } from "@/lib/http/client";
import type { ScheduleEvent } from "@/modules/events/schema";
import type { ListPage } from "@/modules/weddings/schemas";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import g from "@/modules/guests/guests.module.css";
import s from "./delivery.module.css";
type Operation = {
  id: string;
  kind: string;
  mode: string;
  status: string;
  expectedJobs: number;
  counts: Record<string, number>;
  pendingCount: number;
  continueAllowed: boolean;
  version: number;
  createdAt: string;
};
type Preview = {
  selectionToken: string | null;
  eligibleCount: number;
  selectedCount: number;
  excluded: { missingEmail: number; inactive: number };
  mode: string;
  availableToday: number | null;
};
type Job = {
  id: string;
  intendedRecipient: string;
  state: string;
  acceptedAt?: string;
  retryNotBefore?: string;
  lastErrorCode?: string;
};
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Please refresh and try again.";
const modeText = (mode: string) =>
  mode === "simulated"
    ? "Simulated — no email delivery"
    : mode === "test"
      ? "Test — configured test inbox only"
      : "Live delivery";
const labels: Record<string, string> = {
  pending: "Ready to send",
  processing: "Processing",
  accepted: "Accepted by email provider",
  deferredQuota: "Allowance reached",
  retryableFailed: "Waiting to retry",
  permanentlyFailed: "Delivery failed",
  needsReview: "Needs review",
  cancelled: "Cancelled",
  simulated: "Simulated",
};
export function InvitationTools({
  w,
  event,
  rows,
  filter,
}: {
  w: string;
  event: ScheduleEvent;
  rows: { id: string; name: string; email?: string }[];
  filter?: string;
}) {
  const router = useRouter();
  const base = "/api/v1/weddings/" + w,
    home = "/dashboard/" + w + "/guests";
  const [selected, setSelected] = useState<string[]>([]),
    [scope, setScope] = useState("selected"),
    [kind, setKind] = useState("guestInvitation"),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    key = useRef("");
  useEffect(() => {
    if (preview) dialog.current?.showModal();
    else dialog.current?.close();
  }, [preview]);
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      const p = await mutateJson<Preview>(base + "/email-previews", "POST", {
        kind,
        eventId: event.id,
        recipients:
          scope === "selected"
            ? { type: "ids", invitationIds: selected }
            : {
                type: "filter",
                rsvpStatuses:
                  scope === "pending"
                    ? ["pending"]
                    : filter
                      ? [filter]
                      : ["pending", "attending", "declined"],
              },
      });
      key.current = crypto.randomUUID();
      setPreview(p);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!preview?.selectionToken) return;
    setBusy(true);
    try {
      const op = await mutateJson<Operation>(
        base + "/email-operations",
        "POST",
        { selectionToken: preview.selectionToken },
        key.current,
      );
      router.push(
        home + "?view=delivery&event=" + event.id + "&operation=" + op.id,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={s.controls}>
      <div className={s.tools}>
        <label>
          Recipients
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="selected">Selected guests</option>
            <option value="pending">All guests awaiting a response</option>
            <option value="filter">All guests matching this RSVP filter</option>
          </select>
        </label>
        <label>
          Message
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              if (e.target.value === "guestReminder") setScope("pending");
            }}
          >
            <option value="guestInvitation">Invitation</option>
            <option value="guestReminder">Reminder</option>
          </select>
        </label>
        <button
          className={g.primary}
          disabled={busy || (scope === "selected" && !selected.length)}
          onClick={() => void prepare()}
        >
          Preview {kind === "guestReminder" ? "reminder" : "invitation"}
        </button>
        <Link href={home + "?view=delivery&event=" + event.id}>
          Delivery history
        </Link>
      </div>
      {scope === "selected" && (
        <details>
          <summary>{selected.length} selected · Choose recipients</summary>
          <label>
            <input
              type="checkbox"
              checked={
                !!rows.length && rows.every((r) => selected.includes(r.id))
              }
              onChange={(e) =>
                setSelected(e.target.checked ? rows.map((r) => r.id) : [])
              }
            />{" "}
            Select all loaded guests
          </label>
          <div className={s.choices}>
            {rows.map((r) => (
              <label key={r.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(r.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, r.id]
                        : selected.filter((id) => id !== r.id),
                    )
                  }
                />
                {r.name}
                <small>{r.email || "No email added"}</small>
              </label>
            ))}
          </div>
        </details>
      )}
      {!preview && error && <p role="alert">{error}</p>}
      <dialog
        ref={dialog}
        className={s.preview}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setPreview(null);
        }}
      >
        {preview && (
          <>
            <header>
              <span className={g.trail}>
                {event.name} · Private digital invitation
              </span>
              <button
                aria-label="Close preview"
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                ×
              </button>
              <h2>
                Prepare {event.name}{" "}
                {kind === "guestReminder" ? "reminders" : "invitations"}
              </h2>
            </header>
            <div className={s.panel}>
              <small>AUDIENCE SCOPE · {preview.selectedCount} selected</small>
              <div className={s.numbers}>
                <p>
                  <strong>{preview.eligibleCount}</strong>Eligible recipients
                </p>
                <p>
                  <strong>
                    {preview.excluded.missingEmail + preview.excluded.inactive}
                  </strong>
                  Excluded
                </p>
              </div>
              <p>
                {preview.excluded.missingEmail} missing email ·{" "}
                {preview.excluded.inactive} inactive
              </p>
              <Link href={home}>Edit contacts in Guest Directory ↗</Link>
            </div>
            <div className={s.panel}>
              <strong>{modeText(preview.mode)}</strong>
              {preview.availableToday !== null && (
                <p>{preview.availableToday} messages available today</p>
              )}
            </div>
            <small>SAMPLE PREVIEW</small>
            <article className={s.sample}>
              <p>MAKE MY MARRIAGE</p>
              <h2>{event.name}</h2>
              <p>{event.location}</p>
              <p>
                {new Date(event.startsAt).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}{" "}
                IST
              </p>
              <span>Respond to your invitation</span>
              <small>
                Sample button · private RSVP opens from the recipient’s email.
              </small>
            </article>
            {error && <p role="alert">{error}</p>}
            <footer>
              <button
                className={g.primary}
                disabled={busy || !preview.selectionToken}
                onClick={() => void confirm()}
              >
                {busy
                  ? "Preparing…"
                  : "Confirm " + preview.eligibleCount + " recipients"}
              </button>
              <p>
                Confirmation prepares messages. Choose “Send next batch” on the
                next screen to send them.
              </p>
              <button
                className={g.remove}
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                Cancel and return to event
              </button>
            </footer>
          </>
        )}
      </dialog>
    </section>
  );
}
export function DeliveryProgress({
  w,
  event,
  operationId,
}: {
  w: string;
  event: ScheduleEvent;
  operationId?: string;
}) {
  const root = "/api/v1/weddings/" + w + "/email-operations",
    back = "/dashboard/" + w + "/guests?view=events&event=" + event.id;
  const [operation, setOperation] = useState<Operation | null>(null),
    [jobs, setJobs] = useState<ListPage<Job> | null>(null),
    [history, setHistory] = useState<ListPage<Operation> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [cancel, setCancel] = useState(false);
  async function refresh() {
    if (operationId) {
      const [op, list] = await Promise.all([
        getJson<Operation>(root + "/" + operationId),
        getResponse<ListPage<Job>>(root + "/" + operationId + "/jobs"),
      ]);
      setOperation(op);
      setJobs(list);
    } else
      setHistory(
        await getResponse<ListPage<Operation>>(root + "?eventId=" + event.id),
      );
  }
  useEffect(() => {
    const timer = setTimeout(
      () => void refresh().catch((e) => setError(errorText(e))),
      0,
    );
    return () => clearTimeout(timer);
  }, [root, operationId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function act(action: string) {
    if (!operation) return;
    setBusy(true);
    setError("");
    try {
      await mutateJson(
        root + "/" + operation.id + "/" + action,
        "POST",
        action === "cancel" ? { expectedVersion: operation.version } : {},
      );
      setCancel(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      try {
        await refresh();
      } catch (e) {
        setError(errorText(e));
      }
      setBusy(false);
    }
  }
  async function more() {
    setBusy(true);
    try {
      if (operationId && jobs?.page.nextCursor) {
        const next = await getResponse<ListPage<Job>>(
          root +
            "/" +
            operationId +
            "/jobs?cursor=" +
            encodeURIComponent(jobs.page.nextCursor),
        );
        setJobs({ ...next, data: [...jobs.data, ...next.data] });
      } else if (history?.page.nextCursor) {
        const next = await getResponse<ListPage<Operation>>(
          root +
            "?eventId=" +
            event.id +
            "&cursor=" +
            encodeURIComponent(history.page.nextCursor),
        );
        setHistory({ ...next, data: [...history.data, ...next.data] });
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link href={back}>← Back to event roster</Link>
      <div className={g.heading}>
        <div>
          <p className={g.trail}>Ceremony dispatch</p>
          <h1>
            {event.name} ·{" "}
            {operation?.kind === "guestReminder" ? "Reminders" : "Invitations"}
          </h1>
          <p>Private digital RSVP and sending progress</p>
        </div>
        <button
          className={g.soft}
          disabled={busy}
          onClick={() => void refresh().catch((e) => setError(errorText(e)))}
        >
          Refresh status
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {operation ? (
        <>
          <p className={g.pill}>
            {modeText(operation.mode)} · {operation.status}
          </p>
          <section className={s.progress}>
            <div>
              <h2>
                {operation.expectedJobs} prepared · {operation.counts.accepted}{" "}
                {operation.mode === "test" ? "test accepted" : "accepted"}
              </h2>
              <p>
                {operation.pendingCount} remaining ·{" "}
                {operation.counts.simulated} simulated ·{" "}
                {operation.counts.needsReview} need review
              </p>
              <progress
                max={operation.expectedJobs}
                value={
                  operation.expectedJobs -
                  operation.pendingCount -
                  operation.counts.processing
                }
              />
            </div>
            <div>
              <button
                className={g.primary}
                disabled={busy || !operation.continueAllowed}
                onClick={() => void act("continue")}
              >
                {busy ? "Processing…" : "Send next batch"}
              </button>
              <button
                className={g.remove}
                disabled={
                  busy ||
                  operation.status === "cancelled" ||
                  !operation.pendingCount
                }
                onClick={() => setCancel(true)}
              >
                Cancel remaining messages
              </button>
            </div>
            <p className={s.panel}>
              Each click processes up to 10 messages. Choose another batch when
              ready. Provider acceptance does not confirm inbox receipt.
            </p>
          </section>
          <h2>Recipient dispatch</h2>
          <div className={s.jobList}>
            {jobs?.data.map((j) => (
              <article key={j.id}>
                <strong>{j.intendedRecipient}</strong>
                <span className={g.pill}>
                  {j.state === "accepted" && operation.mode === "test"
                    ? "Test accepted"
                    : labels[j.state]}
                </span>
                <small>
                  {j.acceptedAt
                    ? new Date(j.acceptedAt).toLocaleString()
                    : j.retryNotBefore
                      ? "Retry after " +
                        new Date(j.retryNotBefore).toLocaleString()
                      : j.lastErrorCode || "—"}
                </small>
              </article>
            ))}
          </div>
          {jobs?.page.hasMore && (
            <button disabled={busy} onClick={() => void more()}>
              Load more recipients
            </button>
          )}
          <ConfirmDialog
            open={cancel}
            title="Cancel remaining messages?"
            keep="Keep messages"
            confirm="Cancel remaining messages"
            busy={busy}
            blocked={false}
            error={error}
            onClose={() => setCancel(false)}
            onConfirm={() => void act("cancel")}
          >
            <p>
              Messages already submitted cannot be recalled. Their delivery
              outcomes will remain visible.
            </p>
          </ConfirmDialog>
        </>
      ) : history ? (
        <div className={s.jobList}>
          {history.data.map((op) => (
            <article key={op.id}>
              <Link
                href={
                  back.replace("view=events", "view=delivery") +
                  "&operation=" +
                  op.id
                }
              >
                {op.kind === "guestReminder" ? "Reminder" : "Invitation"} ·{" "}
                {new Date(op.createdAt).toLocaleString()}
              </Link>
              <span>{modeText(op.mode)}</span>
              <span>{op.status}</span>
            </article>
          ))}
          {!history.data.length && (
            <p>
              No delivery operations yet. Preview an invitation from the event
              roster.
            </p>
          )}
          {history.page.hasMore && (
            <button onClick={() => void more()} disabled={busy}>
              Load more operations
            </button>
          )}
        </div>
      ) : (
        <p>Loading delivery details…</p>
      )}
    </>
  );
}
