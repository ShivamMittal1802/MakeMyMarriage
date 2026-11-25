"use client";
import { useState, type FormEvent } from "react";
import { ApiClientError, getJson, mutateJson } from "@/lib/http/client";
import type { ScheduleEvent } from "./schema";
import { localParts, toInstant } from "./time";
import s from "./events.module.css";

export function EventForm({
  event,
  base,
  onClose,
  onReview,
  onSaved,
}: {
  event?: ScheduleEvent;
  base: string;
  onClose: () => void;
  onReview: (e: ScheduleEvent) => void;
  onSaved: (message: string) => void;
}) {
  const [end, setEnd] = useState(!!event?.endsAt),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [rangeError, setRangeError] = useState(""),
    [blocked, setBlocked] = useState(false);
  const start = localParts(event?.startsAt),
    finish = localParts(event?.endsAt);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || blocked) return;
    const data = new FormData(e.currentTarget),
      field = (key: string) => String(data.get(key) ?? "").trim();
    setError("");
    setRangeError("");
    setBusy(true);
    try {
      const startsAt = toInstant(
          field("startDate"),
          field("startTime"),
          event?.startsAt,
        ),
        endsAt = end
          ? toInstant(field("endDate"), field("endTime"), event?.endsAt)
          : undefined;
      if (endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
        setRangeError("End time must be on or after the start.");
        return;
      }
      const body = {
        name: field("name"),
        location: field("location"),
        description: field("description"),
        startsAt,
        endsAt,
      };
      const saved = event
        ? await mutateJson<ScheduleEvent>(base + "/" + event.id, "PATCH", {
            ...body,
            expectedVersion: event.version,
            endsAt: endsAt ?? null,
          })
        : await mutateJson<ScheduleEvent>(base, "POST", body);
      onSaved(`${saved.name} ${event ? "updated" : "created"}.`);
    } catch (failure) {
      if (failure instanceof ApiClientError) {
        setBlocked(
          ["VERSION_CONFLICT", "REQUEST_UNCONFIRMED", "NOT_FOUND"].includes(
            failure.code,
          ),
        );
        setError(
          failure.code === "VERSION_CONFLICT"
            ? "This event changed while you were editing."
            : failure.fields.map((f) => f.message).join(" ") || failure.message,
        );
      } else setError("Check the dates and try again.");
    } finally {
      setBusy(false);
    }
  }
  async function review() {
    if (!event) return;
    setBusy(true);
    try {
      onReview(await getJson<ScheduleEvent>(base + "/" + event.id));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn’t load the latest details.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={s.form} onSubmit={save}>
      <h1>{event ? "Edit event" : "Add event"}</h1>
      <fieldset disabled={busy}>
        <label>
          Event name
          <input
            name="name"
            defaultValue={event?.name}
            required
            maxLength={150}
            placeholder="e.g. Sangeet"
          />
        </label>
        <div className={s.sectionTitle}>
          <h2>Start schedule</h2>
          <span>India time (IST)</span>
        </div>
        <div className={s.pair}>
          <label>
            Start date
            <input
              type="date"
              name="startDate"
              defaultValue={start.date}
              required
            />
          </label>
          <label>
            Start time
            <input
              type="time"
              name="startTime"
              defaultValue={start.time}
              required
            />
          </label>
        </div>
        <div className={s.sectionTitle}>
          <h2>End schedule</h2>
          <button
            type="button"
            className={s.text}
            aria-expanded={end}
            onClick={() => {
              setEnd(!end);
              setRangeError("");
            }}
          >
            {end ? "Remove end time" : "Add end time"}
          </button>
        </div>
        {end && (
          <div className={s.end}>
            <div className={s.pair}>
              <label>
                End date
                <input
                  type="date"
                  name="endDate"
                  defaultValue={finish.date || start.date}
                  required
                />
              </label>
              <label>
                End time
                <input
                  type="time"
                  name="endTime"
                  defaultValue={finish.time}
                  required
                />
              </label>
            </div>
            {rangeError && <p role="alert">{rangeError}</p>}
          </div>
        )}
        <label>
          Location or venue
          <input
            name="location"
            defaultValue={event?.location}
            required
            maxLength={500}
          />
        </label>
        <label>
          Description (optional)
          <textarea
            rows={4}
            name="description"
            defaultValue={event?.description}
            maxLength={5000}
          />
        </label>
        {error && (
          <p role="alert" className={s.warning}>
            {error}
          </p>
        )}
        <div className={s.actions}>
          <button type="button" className={s.text} onClick={onClose}>
            {blocked ? "Back to schedule" : "Cancel"}
          </button>
          {blocked ? (
            event && (
              <button type="button" className={s.secondary} onClick={review}>
                Discard draft and review latest details
              </button>
            )
          ) : (
            <button className={s.primary} type="submit">
              {busy ? "Saving…" : event ? "Save changes" : "Create event"}
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
