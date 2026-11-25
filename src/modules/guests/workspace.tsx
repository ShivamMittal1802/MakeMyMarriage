"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/landing/landing-icons";
import { getResponse, mutateJson, ApiClientError } from "@/lib/http/client";
import { dayLabel, timeLabel } from "@/modules/events/time";
import type { ScheduleEvent } from "@/modules/events/schema";
import type { ListPage } from "@/modules/weddings/schemas";
import type { GuestDto } from "./service";
import { guestEvents, guestsByEvent } from "./views";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import s from "@/modules/events/events.module.css";
import g from "./guests.module.css";
type Rsvp = "pending" | "attending" | "declined";
const directory = (w: string) => `/dashboard/${w}/guests`,
  api = (w: string) => `/api/v1/weddings/${w}`;
function feedback(e: unknown) {
  return e instanceof ApiClientError
    ? e.fields.map((f) => f.message).join(" ") || e.message
    : "Couldn’t confirm the request. Refresh to review the latest details.";
}
function usePages<T extends { id: string }>(
  initial: ListPage<T>,
  load: (cursor: string) => Promise<ListPage<T>>,
) {
  const [page, set] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function more() {
    if (!page.page.nextCursor || busy) return;
    setBusy(true);
    try {
      const next = await load(page.page.nextCursor);
      set({
        ...next,
        data: [
          ...new Map(
            [...page.data, ...next.data].map((x) => [x.id, x]),
          ).values(),
        ],
      });
      setError("");
    } catch (e) {
      setError(feedback(e));
    } finally {
      setBusy(false);
    }
  }
  return {
    rows: page.data,
    control: (label: string) => (
      <>
        {error && (
          <p role="alert">
            {error} <a href="">Refresh</a>
          </p>
        )}
        {page.page.hasMore && (
          <button disabled={busy} className={s.more} onClick={more}>
            {busy ? "Loading…" : label}
          </button>
        )}
      </>
    ),
  };
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (
    parts[0][0] + (parts.length > 1 ? parts.at(-1)![0] : "")
  ).toUpperCase();
}
function GuestRow({
  name,
  contact,
  href,
  end,
  roster = false,
}: {
  name: string;
  contact?: string;
  href: string;
  end: ReactNode;
  roster?: boolean;
}) {
  return (
    <div className={g.row}>
      <Link className={g.person} href={href}>
        <span className={g.initial} aria-hidden="true">
          {initials(name)}
        </span>
        {name}
      </Link>
      <span>{contact || <em>No email added</em>}</span>
      <span>{end}</span>
      <Link className={g.view} href={href} aria-label={"View " + name}>
        {roster ? "Manage" : "View"} ›
      </Link>
    </div>
  );
}
function Columns({ roster = false }: { roster?: boolean }) {
  return (
    <div aria-hidden="true" className={g.columns}>
      <span>Guest identity</span>
      <span>Email address</span>
      <span>{roster ? "RSVP status" : "Contact number"}</span>
      <span>Actions</span>
    </div>
  );
}
export function Directory({
  w,
  q,
  initial,
}: {
  w: string;
  q: string;
  initial: ListPage<GuestDto>;
}) {
  const path = directory(w),
    list = usePages(initial, (c) =>
      getResponse(api(w) + "/guests?" + new URLSearchParams({ q, cursor: c })),
    );
  return (
    <>
      <div className={g.heading}>
        <div>
          <span className={g.badge}>● Curated registry</span>
          <h1>Wedding guests</h1>
          <p>
            Manage the invited circle, track contacts, and organize guests
            across ceremonies with effortless discretion.
          </p>
        </div>
        <div className={g.actions}>
          <Link className={g.light} href={path + "?view=events"}>
            Guests by event →
          </Link>
          <Link className={g.primary} href={path + "?view=new"}>
            <span aria-hidden="true">＋ </span>Add guest
          </Link>
        </div>
      </div>
      <form className={g.toolbar} action={path}>
        <label className={g.searchBox}>
          <button aria-label="Search guests">⌕</button>
          <input
            aria-label="Search by name or email"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={150}
            placeholder="Search by name or email…"
          />
        </label>
        <div className={g.actions}>
          {q && <Link href={path}>Clear search</Link>}
          <span className={g.pill}>
            ● Showing {list.rows.length} guest
            {list.rows.length === 1 ? "" : "s"}
          </span>
        </div>
      </form>
      {list.rows.length ? (
        <section aria-label="Guest directory">
          <Columns />
          {list.rows.map((p) => (
            <GuestRow
              key={p.id}
              name={p.name}
              href={path + "?guest=" + p.id}
              contact={p.email}
              end={p.phone || <em>— Not provided</em>}
            />
          ))}
        </section>
      ) : (
        <div className={s.empty}>
          <h2>{q ? "No matching guests" : "No guests yet"}</h2>
          <Link href={q ? path : path + "?view=new"}>
            {q ? "Clear search" : "Add your first guest"}
          </Link>
        </div>
      )}
      {list.control("Load more guests")}
      <aside className={g.callout}>
        <Icon name="calendar" />
        <div>
          <strong>Event-Specific Attendance</strong>
          <p>Review guest lists and RSVP responses for each ceremony.</p>
        </div>
        <Link href={path + "?view=events"}>Open ceremony matrix ↗</Link>
      </aside>
    </>
  );
}
export function GuestForm({
  w,
  person,
  location: venue,
}: {
  w: string;
  person?: GuestDto;
  location: string;
}) {
  const path = directory(w),
    [email, setEmail] = useState(person?.email ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [code, setCode] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget),
      name = String(data.get("name")).trim(),
      phone = String(data.get("phone")).trim();
    setBusy(true);
    try {
      const saved = await mutateJson<GuestDto>(
        api(w) + "/guests" + (person ? "/" + person.id : ""),
        person ? "PATCH" : "POST",
        {
          name,
          email: email.trim() || (person ? null : undefined),
          phone: phone || (person ? null : undefined),
          ...(person && { expectedVersion: person.version }),
        },
      );
      location.assign(
        path + "?guest=" + saved.id + "&notice=" + (person ? "saved" : "added"),
      );
    } catch (e) {
      setError(feedback(e));
      setCode(e instanceof ApiClientError ? e.code : "REQUEST_UNCONFIRMED");
      setBusy(false);
    }
  }
  const blocked = [
    "VERSION_CONFLICT",
    "REQUEST_UNCONFIRMED",
    "NOT_FOUND",
  ].includes(code);
  return (
    <div className={g.formWrap}>
      <Link className={g.trail} href={path}>
        My wedding / Guests / {person ? "Edit guest" : "Add guest"}
      </Link>
      <form className={g.form} onSubmit={save}>
        <div className={g.caption}>
          Registry atelier{" "}
          <span className={g.badge}>
            {person ? "Edit entry" : "● New entry"}
          </span>
        </div>
        <h1>{person ? "Edit guest" : "Add guest"}</h1>
        <p>
          Guests can be added with just a name. You can provide an email or
          phone number whenever available.
        </p>
        <div className={g.formCard}>
          <Icon name="people" />
          <strong>Celebration Directory · {venue}</strong>
        </div>
        <fieldset disabled={busy}>
          <label>
            <span>
              Full name <b>*</b>
              <small>Required</small>
            </span>
            <input
              required
              placeholder="e.g. Riya Shah"
              name="name"
              defaultValue={person?.name}
              maxLength={150}
            />
          </label>
          <label>
            <span>
              Email address <small>Optional</small>
            </span>
            <input
              type="email"
              placeholder="e.g. riya@example.com"
              value={email}
              maxLength={254}
              onChange={(e) => setEmail(e.target.value)}
            />
            <small>
              You can add an email later. It’s needed to send an invitation.
            </small>
          </label>
          {person?.email && email.trim().toLowerCase() !== person.email && (
            <p className={s.notice}>
              Previous RSVP links for this guest will stop working. Their
              recorded responses will be kept.
            </p>
          )}
          <label>
            <span>
              Phone number <small>Optional</small>
            </span>
            <input
              name="phone"
              type="tel"
              placeholder="e.g. +91 98020 00000"
              maxLength={32}
              defaultValue={person?.phone}
            />
          </label>
          <div className={g.formCard}>
            <Icon name="calendar" />
            <div>
              <strong>Upcoming Event Allotment</strong>
              <p>You will select ceremony access after saving.</p>
            </div>
          </div>
          {error && (
            <p className={s.warning} role="alert">
              {error}{" "}
              {code === "DUPLICATE_EMAIL" && (
                <Link href={path + "?q=" + encodeURIComponent(email)}>
                  Find existing guest
                </Link>
              )}
            </p>
          )}
          <div className={s.actions}>
            <Link href={person ? path + "?guest=" + person.id : path}>
              Cancel
            </Link>
            {blocked ? (
              <a href={person ? path + "?guest=" + person.id : path}>
                Review latest details
              </a>
            ) : (
              <button className={s.primary}>
                {busy ? "Saving…" : person ? "Save changes" : "Save guest"}
              </button>
            )}
          </div>
        </fieldset>
      </form>
    </div>
  );
}
type GuestEventPage = Awaited<ReturnType<typeof guestEvents>>;
type EventRow = GuestEventPage["data"][number];
export function GuestDetails({
  w,
  person,
  initial,
  notice,
}: {
  w: string;
  person: GuestDto;
  initial: GuestEventPage;
  notice?: string;
}) {
  const path = directory(w),
    list = usePages(initial, (c) => guestEvents(w, person.id, c)),
    [target, setTarget] = useState<EventRow | "guest" | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [blocked, setBlocked] = useState(false);
  async function act(row: EventRow | "guest", remove = false) {
    if (busy || blocked) return;
    setBusy(true);
    setError("");
    try {
      if (row === "guest") {
        await mutateJson(
          api(w) +
            "/guests/" +
            person.id +
            "?expectedVersion=" +
            person.version,
          "DELETE",
        );
        location.assign(path);
        return;
      }
      const i = row.selection,
        base = api(w) + "/event-invitations";
      if (remove && i)
        await mutateJson(
          base + "/" + i.id + "?expectedVersion=" + i.version,
          "DELETE",
        );
      else if (i)
        await mutateJson(base + "/" + i.id + "/reactivate", "POST", {
          expectedVersion: i.version,
        });
      else
        await mutateJson(base, "POST", { guestId: person.id, eventId: row.id });
      location.assign(
        path +
          "?guest=" +
          person.id +
          "&notice=" +
          (remove ? "withdrawn" : "selected"),
      );
    } catch (e) {
      setError(feedback(e));
      setBusy(false);
      setBlocked(true);
    }
  }
  const message = (
    {
      added: "Guest added.",
      saved: "Guest details saved.",
      withdrawn: "Guest removed from the event.",
      selected: "Guest added to the event.",
    } as Record<string, string>
  )[notice ?? ""];
  return (
    <>
      {message && (
        <p className={s.notice} role="status">
          {message}
        </p>
      )}
      <Link href={path} className={g.trail}>
        Guest directory / Guest profile
      </Link>
      <h1>Guest Profile</h1>
      <div className={g.profile}>
        <span className={g.avatar}>{initials(person.name)}</span>
        <div>
          <h2>{person.name}</h2>
          <div className={g.contacts}>
            <span>
              <Icon name="mail" />
              {person.email ?? "No email added"}
            </span>
            {!person.email && (
              <Link href={path + "?view=edit&guest=" + person.id}>
                Add email ↗
              </Link>
            )}
            {person.phone && <span>{person.phone}</span>}
          </div>
        </div>
        <div className={g.actions}>
          <Link
            className={g.soft}
            href={path + "?view=edit&guest=" + person.id}
          >
            Edit guest
          </Link>
          <button
            className={g.remove}
            disabled={busy}
            onClick={() => setTarget("guest")}
          >
            Remove guest
          </button>
        </div>
      </div>
      <section>
        <h2>Invited events</h2>
        <p className={g.intro}>
          Select the ceremonies and celebrations {person.name} is invited to
          attend. Guests can be invited without an email address.
        </p>
        {!target && error && (
          <p role="alert">
            {error} <a href="">Review latest details</a>
          </p>
        )}
        {list.rows.map((row) => {
          const selected = row.selection?.status === "active",
            date = new Date(row.startsAt);
          return (
            <article key={row.id} className={g.eventRow}>
              <div className={g.date}>
                <small>
                  {date.toLocaleString("en-US", {
                    month: "short",
                    timeZone: "Asia/Kolkata",
                  })}
                </small>
                {date.toLocaleString("en-US", {
                  day: "numeric",
                  timeZone: "Asia/Kolkata",
                })}
              </div>
              <div>
                <div className={g.eventTitle}>
                  <h3>{row.name}</h3>
                  <span className={g.pill}>
                    {selected ? "On guest list" : "Not on guest list"}
                  </span>
                  {selected && (
                    <span className={g.pill}>RSVP: {row.selection?.rsvp}</span>
                  )}
                </div>
                <p>
                  {dayLabel(row.startsAt)} · {timeLabel(row.startsAt)} IST　·　
                  {row.location}
                </p>
                {row.selection?.status === "revoked" && (
                  <small>
                    Adding back keeps the earlier RSVP and sends no email.
                  </small>
                )}
              </div>
              <button
                className={selected ? g.soft : g.primary}
                disabled={busy || blocked}
                onClick={() => (selected ? setTarget(row) : void act(row))}
              >
                {selected
                  ? "Remove from event"
                  : row.selection
                    ? "Add back to event"
                    : "Add to event"}
              </button>
            </article>
          );
        })}
        {!list.rows.length && (
          <p>
            No wedding events yet.{" "}
            <Link href={`/dashboard/${w}/events`}>Open wedding events</Link>
          </p>
        )}
        {list.control("Load more events")}
      </section>
      <ConfirmDialog
        open={!!target}
        title={
          target === "guest"
            ? `Remove ${person.name} from this wedding?`
            : `Remove ${person.name} from ${target?.name}?`
        }
        keep={blocked ? "Review latest details" : "Keep guest"}
        confirm={target === "guest" ? "Remove guest" : "Remove from event"}
        busy={busy}
        blocked={blocked}
        error={error}
        onClose={() => (blocked ? location.reload() : setTarget(null))}
        onConfirm={() => target && void act(target, true)}
      >
        <p>
          {target === "guest"
            ? "Their invitations to every event will be withdrawn and all their RSVP links will stop working."
            : "Their RSVP link for this event will stop working."}
        </p>
      </ConfirmDialog>
    </>
  );
}
type RosterPage = Awaited<ReturnType<typeof guestsByEvent>>;
export function EventRoster({
  w,
  events,
  event,
  initial,
  filter,
  counts,
  q,
}: {
  w: string;
  events: ListPage<ScheduleEvent>;
  event?: ScheduleEvent;
  initial: RosterPage;
  filter?: Rsvp;
  counts: Record<string, number>;
  q: string;
}) {
  const path = directory(w),
    choices = usePages(events, (c) =>
      getResponse(api(w) + "/events?cursor=" + encodeURIComponent(c)),
    ),
    list = usePages(initial, (c) => guestsByEvent(w, event!.id, filter, c, q));
  const total = counts.pending + counts.attending + counts.declined;
  const link = (r?: string) =>
    path +
    "?" +
    new URLSearchParams({
      view: "events",
      event: event?.id ?? "",
      ...(r && { rsvp: r }),
      ...(q && { q }),
    });
  return (
    <>
      <Link className={g.trail} href={path}>
        My wedding / Guests / Guests by event
      </Link>
      <div className={g.heading}>
        <div>
          <h1>Guests by event</h1>
          <p>Review guest lists and RSVP responses for each celebration.</p>
        </div>
        <Link className={g.view} href={path}>
          ← Back to Guest directory
        </Link>
      </div>
      {event ? (
        <>
          <div className={g.eventBar}>
            <label>
              Select event
              <select
                value={event.id}
                onChange={(e) =>
                  location.assign(
                    path +
                      "?view=events&event=" +
                      encodeURIComponent(e.target.value),
                  )
                }
              >
                {[
                  ...new Map(
                    [event, ...choices.rows].map((e) => [e.id, e]),
                  ).values(),
                ].map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {dayLabel(e.startsAt)}
                  </option>
                ))}
              </select>
            </label>
            <div className={g.tags}>
              <span>{event.location}</span>
              <span>{timeLabel(event.startsAt)} IST</span>
            </div>
          </div>
          {choices.control("Load more events")}
          <div className={g.metrics}>
            {[
              ["Total guests", total],
              ["Attending", counts.attending],
              ["Pending", counts.pending],
              ["Declined", counts.declined],
            ].map(([label, n]) => (
              <div key={label}>
                <small>{label}</small>
                <strong>{n}</strong>
                <progress
                  aria-label={String(label)}
                  max={total || 1}
                  value={n}
                />
              </div>
            ))}
          </div>
          <div className={g.toolbar}>
            <div className={g.filters}>
              {([undefined, "attending", "pending", "declined"] as const).map(
                (r) => (
                  <Link
                    aria-current={r === filter ? "page" : undefined}
                    key={r ?? "all"}
                    href={link(r)}
                  >
                    {r ?? "All"} {r ? counts[r] : total}
                  </Link>
                ),
              )}
            </div>
            <form action={path} className={g.searchBox}>
              <input type="hidden" name="view" value="events" />
              <input type="hidden" name="event" value={event.id} />
              {filter && <input type="hidden" name="rsvp" value={filter} />}
              <button aria-label="Search roster">⌕</button>
              <input
                name="q"
                type="search"
                maxLength={150}
                aria-label="Search guests in event"
                defaultValue={q}
                placeholder={"Search guests in " + event.name}
              />
            </form>
          </div>
          <section className={g.roster}>
            <div className={g.caption}>Guest list · {event.name}</div>
            <Columns roster />
            {list.rows.map((p) => (
              <GuestRow
                key={p.id}
                href={path + "?guest=" + p.guestId}
                name={p.name}
                contact={p.email}
                roster
                end={
                  <span className={g.status} data-state={p.rsvp}>
                    ● {p.rsvp}
                  </span>
                }
              />
            ))}
            {!list.rows.length && (
              <p>
                {filter || q
                  ? "No guests match these filters."
                  : "No guests added to " + event.name + " yet."}
              </p>
            )}
            <div className={g.rosterFoot}>
              Showing {list.rows.length} invited guests{" "}
              {list.control("Load more guests")}
            </div>
          </section>
          <div className={g.rosterCards}>
            <article className={g.venue}>
              <span>Event venue</span>
              <h2>{event.location}</h2>
            </article>
            <aside className={g.callout}>
              <Icon name="mail" />
              <div>
                <strong>Guest RSVP Protocol</strong>
                <p>
                  Review responses for this ceremony here. Open a guest profile
                  to manage their event selections.
                </p>
              </div>
            </aside>
          </div>
        </>
      ) : (
        <div className={s.empty}>
          <h2>No wedding events yet</h2>
          <Link href={"/dashboard/" + w + "/events"}>Open wedding events</Link>
        </div>
      )}
    </>
  );
}
