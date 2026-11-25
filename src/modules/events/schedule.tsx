"use client";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import Link from "next/link";
import { useRef, useState } from "react";
import { ApiClientError, getResponse, mutateJson } from "@/lib/http/client";
import type { ListPage } from "@/modules/weddings/schemas";
import type { ScheduleEvent } from "./schema";
import { dayLabel, timeLabel } from "./time";
import { EventForm } from "./event-form";
import s from "./events.module.css";
type Page = ListPage<ScheduleEvent>;
export function Schedule({
  weddingId,
  initial,
}: {
  weddingId: string;
  initial: Page;
}) {
  const base = `/api/v1/weddings/${weddingId}/events`;
  const [list, setList] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<ScheduleEvent | "new" | null>(null),
    [revision, setRevision] = useState(0),
    [removing, setRemoving] = useState<ScheduleEvent | null>(null),
    [deleteError, setDeleteError] = useState(""),
    [stale, setStale] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  async function load(cursor?: string) {
    setBusy(true);
    setError("");
    try {
      const page = await getResponse<Page>(
        base + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      );
      setList((previous) =>
        cursor
          ? {
              ...page,
              data: [
                ...new Map(
                  [...previous.data, ...page.data].map((e) => [e.id, e]),
                ).values(),
              ],
            }
          : page,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn’t load the event schedule.",
      );
    } finally {
      setBusy(false);
    }
  }
  function returnToList(message = "") {
    setEditor(null);
    setNotice(message);
    void load();
    requestAnimationFrame(() => heading.current?.focus());
  }
  async function remove() {
    if (!removing || busy || stale) return;
    setBusy(true);
    try {
      await mutateJson(
        base + "/" + removing.id + "?expectedVersion=" + removing.version,
        "DELETE",
      );
      setList((previous) => ({
        ...previous,
        data: previous.data.filter((e) => e.id !== removing.id),
      }));
      setRemoving(null);
      returnToList(removing.name + " deleted.");
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : "Couldn’t confirm deletion.",
      );
      setStale(
        e instanceof ApiClientError &&
          ["VERSION_CONFLICT", "REQUEST_UNCONFIRMED", "NOT_FOUND"].includes(
            e.code,
          ),
      );
      setBusy(false);
    }
  }
  function closeDialog() {
    setRemoving(null);
    if (stale) void load();
  }
  const groups = new Map<string, ScheduleEvent[]>();
  for (const event of list.data) {
    const day = dayLabel(event.startsAt);
    const items = groups.get(day) ?? [];
    items.push(event);
    groups.set(day, items);
  }
  return (
    <section className={s.wrap}>
      <nav className={s.crumb} aria-label="Breadcrumb">
        <Link href={`/dashboard/${weddingId}`}>My wedding</Link>
        <span aria-hidden="true">›</span>Events
      </nav>
      {editor ? (
        <EventForm
          key={revision}
          base={base}
          event={editor === "new" ? undefined : editor}
          onReview={(e) => {
            setEditor(e);
            setRevision((v) => v + 1);
          }}
          onSaved={returnToList}
          onClose={() => returnToList()}
        />
      ) : (
        <>
          <div className={s.top}>
            <div>
              <h1 ref={heading} tabIndex={-1}>
                Wedding events
              </h1>
              <p>India time (IST)</p>
            </div>
            {list.data.length > 0 && (
              <button
                disabled={busy}
                className={s.primary}
                onClick={() => setEditor("new")}
              >
                + Add event
              </button>
            )}
          </div>
          {notice && (
            <p role="status" className={s.notice}>
              {notice}
            </p>
          )}
          {error && (
            <div className={s.warning} role="alert">
              {error}{" "}
              <button onClick={() => void load()} className={s.text}>
                Try again
              </button>
            </div>
          )}
          {!list.data.length && !error && (
            <div className={s.empty}>
              <h2>No events yet</h2>
              <p>Add the first function to your wedding schedule.</p>
              <button
                className={s.primary}
                disabled={busy}
                onClick={() => setEditor("new")}
              >
                Add your first event
              </button>
            </div>
          )}
          {Array.from(groups, ([day, events]) => (
            <section className={s.group} key={day}>
              <h2>{day}</h2>
              {events.map((event) => (
                <article className={s.card} key={event.id}>
                  <div className={s.time}>
                    {timeLabel(event.startsAt)}
                    {event.endsAt && (
                      <>
                        {" "}
                        –{" "}
                        {dayLabel(event.endsAt) !== day &&
                          dayLabel(event.endsAt) + " "}
                        {timeLabel(event.endsAt)}
                      </>
                    )}
                  </div>
                  <div className={s.details}>
                    <h3>{event.name}</h3>
                    <p>{event.location}</p>
                    {event.description && (
                      <p className={s.description}>{event.description}</p>
                    )}
                  </div>
                  <div className={s.tools}>
                    <button
                      disabled={busy}
                      className={s.secondary}
                      aria-label={"Edit " + event.name}
                      onClick={() => setEditor(event)}
                    >
                      Edit
                    </button>
                    <button
                      disabled={busy}
                      className={s.text}
                      aria-label={"Delete " + event.name}
                      onClick={() => {
                        setRemoving(event);
                        setDeleteError("");
                        setStale(false);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ))}
          {list.page.nextCursor && !error && (
            <button
              className={s.more}
              disabled={busy}
              onClick={() => void load(list.page.nextCursor!)}
            >
              {busy ? "Loading…" : "Load more events"}
            </button>
          )}
        </>
      )}
      <ConfirmDialog
        open={!!removing}
        title={`Delete ${removing?.name}?`}
        error={deleteError}
        busy={busy}
        blocked={stale}
        keep={stale ? "Review schedule" : "Keep event"}
        confirm={busy ? "Deleting…" : "Delete event"}
        onClose={closeDialog}
        onConfirm={remove}
      >
        {removing && (
          <>
            {" "}
            <div className={s.summary}>
              <strong>{removing.name}</strong>
              <p>
                {dayLabel(removing.startsAt)} · {timeLabel(removing.startsAt)}{" "}
                IST
              </p>
              <p>{removing.location}</p>
            </div>
            <p>
              {removing.name} will be removed from the wedding schedule. Its
              invitation links will stop working, and its RSVPs will no longer
              appear in active views.
            </p>
          </>
        )}
      </ConfirmDialog>
    </section>
  );
}
