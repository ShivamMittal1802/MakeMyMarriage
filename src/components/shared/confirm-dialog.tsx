"use client";
import { useEffect, useRef, useId, type ReactNode } from "react";
import s from "@/modules/events/events.module.css";
export function ConfirmDialog({
  open,
  title,
  children,
  busy,
  blocked = false,
  error,
  keep,
  confirm,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  busy: boolean;
  blocked?: boolean;
  error?: string;
  keep: string;
  confirm: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    label = useId();
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={s.dialog}
      aria-labelledby={label}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id={label}>{title}</h2>
      {children}
      {error && <p role="alert">{error}</p>}
      <div className={s.actions}>
        <button
          autoFocus
          className={s.secondary}
          disabled={busy}
          onClick={onClose}
        >
          {keep}
        </button>
        <button
          className={s.danger}
          disabled={busy || blocked}
          onClick={onConfirm}
        >
          {confirm}
        </button>
      </div>
    </dialog>
  );
}
