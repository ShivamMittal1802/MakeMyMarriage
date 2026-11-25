"use client";
import s from "@/modules/public-weddings/celebration.module.css";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className={s.message}>
      <h1>Couldn’t load this celebration</h1>
      <p>Please try again in a moment.</p>
      <button className={s.primary} onClick={reset}>
        Try again
      </button>
    </main>
  );
}
