"use client";
/* eslint-disable @next/next/no-img-element -- private signed URLs must bypass public image optimisation */
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { getJson, getResponse, mutateJson } from "@/lib/http/client";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type {
  GalleryPhoto,
  PhotoPage,
  Purpose,
  UploadStatus,
  UploadTicket,
} from "./schema";
import s from "./photos.module.css";
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";
const size = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
export function PhotoShell({ children }: { children: ReactNode }) {
  return (
    <div className={s.shell}>
      <header className={s.header}>
        <Link href="/">
          Make My Marriage<small>PRIVATE CELEBRATION PORTAL</small>
        </Link>
        <span>♧ Private access</span>
      </header>
      <main>{children}</main>
      <footer>Make My Marriage · Your memories, shared privately</footer>
    </div>
  );
}
function Modal({
  children,
  title,
  onClose,
  viewer = false,
}: {
  children: ReactNode;
  title: string;
  onClose: () => void;
  viewer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={viewer ? s.viewer : s.dialog}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <button
        autoFocus
        className={s.close}
        onClick={onClose}
        aria-label="Close"
      >
        ×
      </button>
      {children}
    </dialog>
  );
}
export function SharePhotos({
  w,
  couple,
  onClose,
}: {
  w: string;
  couple: string;
  onClose: () => void;
}) {
  const [purpose, setPurpose] = useState<Purpose>("upload"),
    [link, setLink] = useState(""),
    [qr, setQr] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const request = useRef(0);
  async function load(p: Purpose) {
    const generation = ++request.current;
    setPurpose(p);
    setLink("");
    setQr("");
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await mutateJson<{ url: string }>(
        `/api/v1/weddings/${w}/gallery-access/${p}/share-link`,
        "POST",
        {},
      );
      const image = await QRCode.toDataURL(result.url, {
        width: 360,
        margin: 2,
        color: { dark: "#580d2b", light: "#ffffff" },
      });
      if (generation === request.current) {
        setLink(result.url);
        setQr(image);
      }
    } catch (e) {
      if (generation === request.current) setError(message(e));
    } finally {
      if (generation === request.current) setBusy(false);
    }
  }
  return (
    <Modal title="Share photo access" onClose={onClose}>
      <p className={s.eyebrow}>CURATION & ACCESS</p>
      <h2>Share photo access</h2>
      <p>Generate private links and QR codes for guests and family.</p>
      <div className={s.notice}>
        <strong>{couple}</strong>
        <p>
          Share these links with people you trust. Anyone with a link can
          forward it.
        </p>
      </div>
      <div className={s.tabs}>
        <button
          aria-pressed={purpose === "upload"}
          onClick={() => void load("upload")}
        >
          Collect photos
        </button>
        <button
          aria-pressed={purpose === "view"}
          onClick={() => void load("view")}
        >
          View photos
        </button>
      </div>
      <p>
        {purpose === "upload"
          ? "Let guests upload photos from their phone or camera. This does not grant gallery viewing."
          : "Let guests browse and download wedding photos. This does not grant upload or management access."}
      </p>
      {!link && (
        <button
          className={s.primary}
          disabled={busy}
          onClick={() => void load(purpose)}
        >
          {busy ? "Preparing private link…" : `Get ${purpose} link`}
        </button>
      )}
      {qr && (
        <div className={s.qr}>
          <span className={s.eyebrow}>
            {purpose === "upload"
              ? "GUEST UPLOAD QR · PRINT ON TABLE CARDS"
              : "PRIVATE GALLERY QR"}
          </span>
          <img
            src={qr}
            width={240}
            height={240}
            alt={`QR code for private photo ${purpose}`}
          />
        </div>
      )}
      {link && (
        <>
          <label className={s.linkLabel}>
            Private {purpose} link
            <input readOnly value={link} onFocus={(e) => e.target.select()} />
          </label>
          <button
            className={s.primary}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setNotice("Link copied");
              } catch {
                setError(
                  "Copy is unavailable. Select and copy the link above.",
                );
              }
            }}
          >
            Copy {purpose} link
          </button>
          <a
            className={s.secondary}
            href={qr}
            download={`wedding-photo-${purpose}-qr.png`}
          >
            Download {purpose} QR
          </a>
        </>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
      <small>Gallery viewing and photo contribution use separate links.</small>
    </Modal>
  );
}
export function PhotoGallery({
  w,
  member = false,
  couple = "Wedding memories",
  configured = true,
}: {
  w: string;
  member?: boolean;
  couple?: string;
  configured?: boolean;
}) {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [share, setShare] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [remove, setRemove] = useState<GalleryPhoto | null>(null),
    [deleting, setDeleting] = useState(false),
    [deleteError, setDeleteError] = useState(""),
    [notice, setNotice] = useState("");
  async function load(next?: string) {
    setBusy(true);
    setError("");
    try {
      const page = await getResponse<PhotoPage>(
        `/api/v1/gallery/${w}/photos${next ? `?cursor=${encodeURIComponent(next)}` : ""}`,
      );
      setPhotos((old) =>
        next
          ? [
              ...old,
              ...page.data.filter((p) => !old.some((o) => o.id === p.id)),
            ]
          : page.data,
      );
      setCursor(page.page.nextCursor);
      setLoaded(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    void getResponse<PhotoPage>(`/api/v1/gallery/${w}/photos`)
      .then((page) => {
        if (cancelled) return;
        setPhotos(page.data);
        setCursor(page.page.nextCursor);
        setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) setError(message(e));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [w, configured]);
  const index = photos.findIndex((p) => p.id === selected),
    current = photos[index];
  async function refreshPreview(photo: GalleryPhoto) {
    try {
      const fresh = await getJson<GalleryPhoto>(
        `/api/v1/gallery/${w}/photos/${photo.id}`,
      );
      setPhotos((old) => old.map((p) => (p.id === fresh.id ? fresh : p)));
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className={s.gallery}>
      <div className={s.heading}>
        <div>
          <p className={s.eyebrow}>{couple} · PRIVATE COLLECTION</p>
          <h1>Wedding photos</h1>
          <p>
            Collect and enjoy the moments your guests captured across every
            intimate ritual and grand ceremony.
          </p>
        </div>
        {member && (
          <div className={s.actions}>
            <button className={s.secondary} onClick={() => setShare(true)}>
              ↗ Share photo access
            </button>
            <Link className={s.primary} href={`/dashboard/${w}/photos/upload`}>
              ＋ Upload photos
            </Link>
          </div>
        )}
      </div>
      <div className={s.toolbar}>
        <span>All wedding photos</span>
        <span>Newest first</span>
      </div>
      {!configured ? (
        <div className={s.empty}>
          <h2>Photo storage isn’t configured yet</h2>
          <p>
            Your private gallery will be available after storage setup is
            complete.
          </p>
        </div>
      ) : (
        <>
          {error && (
            <div className={s.error} role="alert">
              {error}{" "}
              <button onClick={() => void load()} disabled={busy}>
                Try again
              </button>
            </div>
          )}
          {!loaded && !error && <p role="status">Loading wedding memories…</p>}
          {loaded && !photos.length && (
            <div className={s.empty}>
              <span>▧</span>
              <h2>Your memories begin here</h2>
              <p>
                {member
                  ? "Upload your first wedding photos or share a private upload link with your guests."
                  : "No photos have been shared yet. Check back after the celebration."}
              </p>
            </div>
          )}
          <div className={s.grid}>
            {photos.map((photo) => (
              <article
                key={photo.id}
                className={photo.width > photo.height * 1.25 ? s.landscape : ""}
              >
                <button
                  className={s.photo}
                  onClick={() => setSelected(photo.id)}
                  aria-label={`View ${photo.filename}`}
                >
                  <PrivateImage
                    photo={photo}
                    refresh={() => void refreshPreview(photo)}
                  />
                  <span>{photo.filename}</span>
                </button>
                {member && (
                  <button
                    className={s.remove}
                    aria-label={`Remove ${photo.filename}`}
                    onClick={() => {
                      setDeleteError("");
                      setRemove(photo);
                    }}
                  >
                    ×
                  </button>
                )}
              </article>
            ))}
          </div>
          {cursor && (
            <button
              className={`${s.secondary} ${s.more}`}
              disabled={busy}
              onClick={() => void load(cursor)}
            >
              {busy ? "Loading…" : "Load more photos ↓"}
            </button>
          )}
          <p className={s.count}>
            {loaded && photos.length > 0
              ? `${photos.length} photos loaded`
              : ""}
          </p>
        </>
      )}
      <p role="status">{notice}</p>
      {share && (
        <SharePhotos w={w} couple={couple} onClose={() => setShare(false)} />
      )}
      {current && (
        <PhotoViewer
          w={w}
          photo={current}
          index={index}
          count={photos.length}
          prev={() => setSelected(photos[index - 1]?.id ?? selected)}
          next={() => setSelected(photos[index + 1]?.id ?? selected)}
          refresh={() => void refreshPreview(current)}
          onClose={() => setSelected(null)}
        />
      )}
      <ConfirmDialog
        open={!!remove}
        title="Remove this photo?"
        busy={deleting}
        error={deleteError}
        keep="Keep photo"
        confirm="Remove photo"
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          if (!remove) return;
          setDeleting(true);
          try {
            const result = await mutateJson<
              { cleanupPending?: boolean } | undefined
            >(
              `/api/v1/weddings/${w}/photos/${remove.id}?expectedVersion=${remove.version}`,
              "DELETE",
            );
            setPhotos((old) => old.filter((p) => p.id !== remove.id));
            setNotice(
              result?.cleanupPending
                ? "Photo hidden. Storage cleanup is pending."
                : "Photo removed.",
            );
            setRemove(null);
          } catch (e) {
            setDeleteError(message(e));
          } finally {
            setDeleting(false);
          }
        }}
      >
        <p>
          This removes the photo from your gallery. Previously downloaded copies
          cannot be recalled.
        </p>
        <strong>{remove?.filename}</strong>
      </ConfirmDialog>
    </section>
  );
}
function PrivateImage({
  photo,
  refresh,
}: {
  photo: GalleryPhoto;
  refresh: () => void;
}) {
  const [failed, setFailed] = useState(false),
    attempted = useRef("");
  return (
    <>
      {failed ? (
        <span className={s.imageError}>
          Preview unavailable{" "}
          <span> · Close and refresh the gallery to retry</span>
        </span>
      ) : (
        <img
          src={photo.preview.url}
          alt={photo.filename}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => {
            if (
              attempted.current !== photo.preview.url &&
              Date.parse(photo.preview.expiresAt) <= Date.now()
            ) {
              attempted.current = photo.preview.url;
              refresh();
            } else setFailed(true);
          }}
        />
      )}
    </>
  );
}
function PhotoViewer({
  w,
  photo,
  index,
  count,
  prev,
  next,
  refresh,
  onClose,
}: {
  w: string;
  photo: GalleryPhoto;
  index: number;
  count: number;
  prev: () => void;
  next: () => void;
  refresh: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={`Viewing ${photo.filename}`} onClose={onClose} viewer>
      <div className={s.viewerTop}>
        <button onClick={onClose}>← Gallery</button>
        <span>
          PHOTO {index + 1} OF {count} LOADED
        </span>
      </div>
      <div
        className={s.stage}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") prev();
          if (e.key === "ArrowRight") next();
        }}
      >
        <button disabled={!index} onClick={prev} aria-label="Previous photo">
          ‹
        </button>
        <PrivateImage key={photo.id} photo={photo} refresh={refresh} />
        <button
          disabled={index === count - 1}
          onClick={next}
          aria-label="Next photo"
        >
          ›
        </button>
      </div>
      <div className={s.viewerInfo}>
        <div>
          <h2>{photo.filename}</h2>
          <p>
            {size(photo.sizeBytes)} · {photo.width} × {photo.height}
          </p>
        </div>
        <button
          className={s.primary}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await mutateJson<{ url: string }>(
                `/api/v1/gallery/${w}/photos/${photo.id}/download`,
                "POST",
                {},
              );
              const link = document.createElement("a");
              link.href = result.url;
              link.rel = "noreferrer";
              link.download = photo.filename;
              link.click();
            } catch (e) {
              setError(message(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? "Preparing…"
            : `↓ Download original (${size(photo.sizeBytes)})`}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

type Selection = {
  key: string;
  file: File;
  state: "queued" | "uploading" | "processing" | "ready" | "error";
  progress: number;
  error?: string;
  photoId?: string;
  transferred?: boolean;
  invalid?: boolean;
};
function transfer(
  url: string,
  headers: Record<string, string>,
  file: File,
  progress: (value: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = 60_000;
    Object.entries(headers).forEach(([key, value]) =>
      xhr.setRequestHeader(key, value),
    );
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new Error(
              "The transfer could not be confirmed. Retry this file to inspect its status and renew its upload link.",
            ),
          );
    xhr.onerror = xhr.ontimeout = () =>
      reject(
        new Error(
          "The connection was interrupted. Check your connection and retry this file.",
        ),
      );
    xhr.send(file);
  });
}
export function PhotoUpload({
  w,
  couple = "Wedding celebration",
  configured = true,
  member = false,
}: {
  w: string;
  couple?: string;
  configured?: boolean;
  member?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null),
    [files, setFiles] = useState<Selection[]>([]),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const patch = (key: string, change: Partial<Selection>) =>
    setFiles((old) =>
      old.map((f) => (f.key === key ? { ...f, ...change } : f)),
    );
  function select(list: FileList | null) {
    if (!list || busy || !configured) return;
    const selected = Array.from(list)
      .slice(0, Math.max(0, 50 - files.length))
      .map((file) => {
        const error = !["image/jpeg", "image/png", "image/webp"].includes(
          file.type,
        )
          ? "Unsupported format. Choose JPEG, PNG or WebP."
          : file.size < 1 || file.size > 20_000_000
            ? "Photo must be between 1 byte and 20 MB."
            : undefined;
        return {
          key: crypto.randomUUID(),
          file,
          state: error ? ("error" as const) : ("queued" as const),
          progress: 0,
          error,
          invalid: !!error,
        };
      });
    setFiles((old) => [...old, ...selected]);
    setNotice("You can select up to 50 files at a time.");
  }
  async function send(file: Selection) {
    patch(file.key, { error: undefined });
    try {
      let ticket: UploadTicket | undefined;
      if (file.photoId) {
        const result = await getJson<UploadStatus>(
          `/api/v1/gallery/${w}/uploads/${file.photoId}`,
        );
        if (result.state === "ready") {
          patch(file.key, { state: "ready", progress: 100 });
          return;
        }
        if (["rejected", "deleted", "deleting"].includes(result.state)) {
          patch(file.key, { invalid: true });
          throw new Error(
            "This upload is no longer available. Remove it and select the photo again.",
          );
        }
        if (result.state === "processing" && !result.canRetryComplete) {
          patch(file.key, {
            state: "processing",
            error: `Processing is still active. Check again in ${result.retryAfterSeconds ?? 10} seconds.`,
          });
          return;
        }
      }
      if (!file.transferred) {
        ticket = await mutateJson<UploadTicket>(
          `/api/v1/gallery/${w}/uploads`,
          "POST",
          {
            filename: file.file.name,
            contentType: file.file.type,
            sizeBytes: file.file.size,
          },
          file.key,
        );
        file = { ...file, photoId: ticket.photoId };
        patch(file.key, { photoId: ticket.photoId });
        if (ticket.state === "ready") {
          patch(file.key, { state: "ready", progress: 100 });
          return;
        }
        if (ticket.upload) {
          patch(file.key, { state: "uploading", progress: 0 });
          await transfer(
            ticket.upload.url,
            ticket.upload.headers,
            file.file,
            (progress) => patch(file.key, { progress }),
          );
          patch(file.key, { transferred: true });
        } else if (!ticket.canRetryComplete) {
          patch(file.key, {
            state: "processing",
            error: "Processing is active. Check status shortly.",
          });
          return;
        }
      }
      patch(file.key, { state: "processing" });
      const result = await mutateJson<UploadStatus>(
        `/api/v1/gallery/${w}/uploads/${file.photoId}/complete`,
        "POST",
        {},
      );
      patch(file.key, {
        state:
          result.state === "ready"
            ? "ready"
            : result.state === "rejected"
              ? "error"
              : "processing",
        progress: 100,
        ...(result.state === "rejected" && {
          invalid: true,
          error: "This file was rejected. Remove it and select a valid photo.",
        }),
      });
    } catch (e) {
      patch(file.key, { state: "error", error: message(e) });
    }
  }
  async function run(selection: Selection[]) {
    setBusy(true);
    for (const file of selection) await send(file);
    setBusy(false);
  }
  return (
    <section className={s.uploadCard}>
      <div className={s.monogram}>♡</div>
      <p className={s.eyebrow}>{couple}</p>
      <h1>Share your wedding memories</h1>
      <p>
        We would love to see the moments you captured during our wedding
        celebration. Upload your candid shots, heartfelt portraits, and
        cherished glimpses below.
      </p>
      <span className={s.badge}>
        {member
          ? "PRIVATE WEDDING PHOTOS"
          : "NO ACCOUNT NEEDED · PRIVATE GUEST UPLOAD"}
      </span>
      {!configured && (
        <p className={s.notice} role="status">
          Photo storage isn’t configured yet. Please return after setup is
          complete.
        </p>
      )}
      <div
        className={s.dropzone}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          select(e.dataTransfer.files);
        }}
      >
        <span>▧</span>
        <input
          ref={input}
          hidden
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            select(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          className={s.primary}
          disabled={busy || !configured}
          onClick={() => input.current?.click()}
        >
          ＋ Choose photos
        </button>
        <p>or drag and drop your files here</p>
        <small>
          JPEG, PNG, WebP · Max 20 MB per photo
          <br />
          Video, HEIC and animated images are not supported
        </small>
      </div>
      {files.length > 0 && (
        <>
          <div className={s.queueHeading}>
            <strong>
              {files.length} photos selected{" "}
              <span>({size(files.reduce((n, f) => n + f.file.size, 0))})</span>
            </strong>
            <button
              className={s.primary}
              disabled={busy || !files.some((f) => f.state === "queued")}
              onClick={() =>
                void run(files.filter((f) => f.state === "queued"))
              }
            >
              {busy ? "Please wait…" : "Upload selected photos"}
            </button>
          </div>
          <ul className={s.queue}>
            {files.map((file) => (
              <li key={file.key} className={file.error ? s.fileError : ""}>
                <div className={s.fileIcon}>▧</div>
                <div>
                  <strong>{file.file.name}</strong>{" "}
                  <small>{size(file.file.size)}</small>
                  <p role="status">
                    {file.error ??
                      {
                        queued: "Queued · Ready to transfer",
                        uploading: `Uploading · ${file.progress}%`,
                        processing: "Transfer complete · Preparing your photo",
                        ready: "Saved · Thank you for sharing",
                        error: "Upload needs attention",
                      }[file.state]}
                  </p>
                  {file.state === "uploading" && (
                    <progress
                      value={file.progress}
                      max={100}
                      aria-label={`Uploading ${file.file.name}`}
                    />
                  )}
                  {["error", "processing"].includes(file.state) &&
                    !file.invalid && (
                      <button disabled={busy} onClick={() => void run([file])}>
                        {file.state === "processing"
                          ? "Check status / complete"
                          : "Retry this file"}
                      </button>
                    )}
                </div>
                {file.state === "ready" ? (
                  <span className={s.badge}>SAVED</span>
                ) : (
                  <button
                    disabled={busy}
                    aria-label={`Remove ${file.file.name} from selection`}
                    onClick={() =>
                      setFiles((old) => old.filter((f) => f.key !== file.key))
                    }
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className={s.count} role="status">
        {notice}
      </p>
      <small>
        {member ? (
          <Link href={`/dashboard/${w}/photos`}>← Back to wedding photos</Link>
        ) : (
          "Private contribution only. Gallery viewing requires a separate link."
        )}
      </small>
    </section>
  );
}
export function PhotoExchange({ purpose }: { purpose: Purpose }) {
  const [error, setError] = useState(""),
    started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fragment = new URLSearchParams(location.hash.slice(1)),
      token = fragment.get("token");
    history.replaceState(null, "", location.pathname);
    if (!token) {
      void Promise.resolve().then(() =>
        setError("Reopen your original private photo link to continue."),
      );
      return;
    }
    void mutateJson<{ cleanPath: string }>("/api/v1/access/gallery", "POST", {
      token,
      purpose,
    })
      .then((result) => location.replace(result.cleanPath))
      .catch((e) => setError(message(e)));
  }, [purpose]);
  return (
    <section className={s.uploadCard}>
      <h1>
        {error
          ? "Photo access unavailable"
          : "Opening your private photo link…"}
      </h1>
      <p role={error ? "alert" : "status"}>
        {error || "Checking your invitation. No account is needed."}
      </p>
    </section>
  );
}
