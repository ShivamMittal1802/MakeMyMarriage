"use client";
import { useState } from "react";
import type { PublicEventPage } from "./service";
import { ApiClientError, getResponse } from "@/lib/http/client";
import { dayLabel, timeLabel } from "@/modules/events/time";
import s from "./celebration.module.css";
type Event = PublicEventPage["data"][number];
export function PublicSchedule({
  initial,
  endpoint,
}: {
  initial: PublicEventPage | null;
  endpoint: string;
}) {
  const [page, setPage] = useState(initial),
    [failed, setFailed] = useState(!initial),
    [restart, setRestart] = useState(false),
    [pending, setPending] = useState(false);
  async function load() {
    if (pending) return;
    setPending(true);
    const cursor = restart ? null : page?.page.nextCursor;
    try {
      const result = await getResponse<PublicEventPage>(
        endpoint + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      );
      setPage((previous) =>
        cursor && previous
          ? {
              ...result,
              data: Array.from(
                new Map(
                  [...previous.data, ...result.data].map((e) => [e.id, e]),
                ).values(),
              ).sort(
                (a, b) =>
                  a.startsAt.localeCompare(b.startsAt) ||
                  a.id.localeCompare(b.id),
              ),
            }
          : result,
      );
      setFailed(false);
      setRestart(false);
    } catch (error) {
      setFailed(true);
      if (error instanceof ApiClientError && error.code === "INVALID_CURSOR")
        setRestart(true);
    } finally {
      setPending(false);
    }
  }
  const groups = new Map<string, Event[]>();
  for (const event of page?.data ?? []) {
    const date = dayLabel(event.startsAt);
    const items = groups.get(date) ?? [];
    items.push(event);
    groups.set(date, items);
  }
  return (
    <section id="schedule" className={s.schedule}>
      <h2>Wedding schedule</h2>
      <p className={s.caption}>All times in India Standard Time (IST)</p>
      {Array.from(groups, ([day, events]) => (
        <section key={day} className={s.group}>
          <h3>{day}</h3>
          <ul>
            {events.map((e) => (
              <li key={e.id}>
                <div className={s.when}>
                  <time dateTime={e.startsAt}>{timeLabel(e.startsAt)}</time>
                  {e.endsAt && (
                    <>
                      {" "}
                      –{" "}
                      <time dateTime={e.endsAt}>
                        {dayLabel(e.endsAt) !== day &&
                          dayLabel(e.endsAt) + " · "}
                        {timeLabel(e.endsAt)}
                      </time>
                    </>
                  )}
                </div>
                <h4>{e.name}</h4>
                <div className={s.venue}>
                  <p>{e.location}</p>
                  {e.description && (
                    <p className={s.description}>{e.description}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {page && page.data.length === 0 && !failed && (
        <p className={s.state}>The wedding schedule hasn’t been added yet.</p>
      )}
      {failed && (
        <p role="status" className={s.state}>
          {page?.data.length
            ? "Couldn’t load more events."
            : "Couldn’t load the wedding schedule."}
        </p>
      )}
      {(failed || page?.page.hasMore) && (
        <button
          type="button"
          disabled={pending}
          onClick={load}
          className={s.secondary}
        >
          {pending ? "Loading…" : failed ? "Try again" : "Load more events"}
        </button>
      )}
    </section>
  );
}
