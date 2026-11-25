"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, getJson, mutateJson } from "@/lib/http/client";
import type { WeddingDto, WeddingPatch } from "../schemas";
import styles from "./onboarding.module.css";

function streamUrl(wedding: WeddingDto) {
  return wedding.youtubeVideoId
    ? `https://www.youtube.com/watch?v=${wedding.youtubeVideoId}`
    : "";
}

export function WeddingDetailsEditor({ wedding }: { wedding: WeddingDto }) {
  const router = useRouter();
  const [original, setOriginal] = useState<WeddingDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const editButton = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const endpoint = `/api/v1/weddings/${wedding.id}`;

  function close(notice: string) {
    setOriginal(null);
    setMessage(notice);
    setError("");
    setNeedsReload(false);
    requestAnimationFrame(() => editButton.current?.focus());
  }
  async function reload() {
    setBusy(true);
    try {
      const latest = await getJson<WeddingDto>(endpoint);
      setOriginal(latest);
      // An unconfirmed write may leave the version unchanged.
      form.current?.reset();
      setNeedsReload(false);
      setError("");
      setMessage("Latest details loaded. Review them before saving.");
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Couldn’t load the wedding.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!original || busy || needsReload) return;
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "").trim();
    const changes: WeddingPatch = { expectedVersion: original.version };
    const couple = {
      brideName: field("brideName"),
      groomName: field("groomName"),
    };
    if (
      couple.brideName !== original.couple.brideName ||
      couple.groomName !== original.couple.groomName
    )
      changes.couple = couple;
    if (field("location") !== original.location)
      changes.location = field("location");
    if (field("weddingDate") !== original.weddingDate)
      changes.weddingDate = field("weddingDate");
    if (field("introduction") !== (original.introduction ?? ""))
      changes.introduction = field("introduction");
    if (field("youtubeUrl") !== streamUrl(original))
      changes.youtubeUrl = field("youtubeUrl") || null;
    if (Object.keys(changes).length === 1) {
      close("No changes to save.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await mutateJson<WeddingDto>(endpoint, "PATCH", changes);
      close("Wedding details saved.");
      router.refresh();
    } catch (failure) {
      if (failure instanceof ApiClientError) {
        setNeedsReload(
          ["VERSION_CONFLICT", "REQUEST_UNCONFIRMED"].includes(failure.code),
        );
        setError(
          failure.fields.map((f) => f.message).join(" ") || failure.message,
        );
      } else setError("Couldn’t save your wedding details. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {message && (
        <p className={styles.notice} role="status">
          {message}
        </p>
      )}
      {!original ? (
        <button
          ref={editButton}
          type="button"
          className={styles.secondary}
          onClick={() => {
            setOriginal(wedding);
            setMessage("");
            requestAnimationFrame(() =>
              form.current?.querySelector("input")?.focus(),
            );
          }}
        >
          Edit wedding details
        </button>
      ) : (
        <form
          key={original.version}
          ref={form}
          className={styles.formCard}
          onSubmit={save}
        >
          <fieldset disabled={busy} className={styles.formSection}>
            <legend>Edit wedding details</legend>
            <div className={styles.fieldGrid}>
              {(
                [
                  ["brideName", "Bride’s name", original.couple.brideName, 150],
                  ["groomName", "Groom’s name", original.couple.groomName, 150],
                  [
                    "weddingDate",
                    "Wedding date",
                    original.weddingDate,
                    undefined,
                  ],
                  ["location", "Location", original.location, 500],
                ] as const
              ).map(([name, label, value, maxLength]) => (
                <div className={styles.field} key={name}>
                  <label htmlFor={name}>{label}</label>
                  <input
                    id={name}
                    name={name}
                    type={name === "weddingDate" ? "date" : "text"}
                    required
                    maxLength={maxLength}
                    defaultValue={value}
                  />
                </div>
              ))}
            </div>
            <div className={styles.field}>
              <label htmlFor="introduction">Introduction (optional)</label>
              <textarea
                id="introduction"
                name="introduction"
                rows={4}
                maxLength={5000}
                defaultValue={original.introduction ?? ""}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="youtubeUrl">
                YouTube livestream link (optional)
              </label>
              <input
                id="youtubeUrl"
                type="url"
                name="youtubeUrl"
                defaultValue={streamUrl(original)}
                maxLength={2048}
                aria-describedby="stream-help"
              />
              <small id="stream-help">
                Paste a YouTube video link, or clear this field to remove the
                stream.
              </small>
            </div>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className={styles.formActions}>
              {needsReload ? (
                <button
                  type="button"
                  className={styles.primary}
                  onClick={reload}
                >
                  Discard draft and load latest details
                </button>
              ) : (
                <button className={styles.primary} type="submit">
                  {busy ? "Saving…" : "Save changes"}
                </button>
              )}
              <button
                type="button"
                className={styles.secondary}
                onClick={() => close("")}
              >
                Cancel
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </>
  );
}
