import Link from "next/link";
import { notFound } from "next/navigation";
import { AppError } from "@/lib/http/errors";
import {
  publicWedding,
  publicEvents,
  type PublicEventPage,
} from "@/modules/public-weddings/service";
import { PublicSchedule } from "@/modules/public-weddings/schedule";
import { dayLabel } from "@/modules/events/time";
import s from "@/modules/public-weddings/celebration.module.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Wedding celebration | Make My Marriage",
  description: "Wedding details, schedule and ceremony.",
};
export default async function Celebration({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const wedding = await publicWedding(slug).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  let schedule: PublicEventPage | null = null;
  try {
    schedule = await publicEvents(slug);
  } catch {
    /* Keep the invitation and ceremony available while the schedule is offline. */
  }
  const { brideName, groomName } = wedding.couple,
    names = brideName + " & " + groomName;
  return (
    <div className={s.page}>
      <a className={s.skip} href="#celebration">
        Skip to celebration
      </a>
      <header className={s.bar}>
        <span className={s.brand}>Make My Marriage</span>
        <nav aria-label="Celebration navigation">
          <a href="#schedule">Schedule</a>
          {wedding.livestream && <a href="#ceremony">Ceremony</a>}
        </nav>
      </header>
      <main id="celebration" className={s.paper}>
        <header className={s.hero}>
          <span aria-hidden="true" className={s.monogram}>
            {Array.from(brideName)[0]} · {Array.from(groomName)[0]}
          </span>
          <p className={s.kicker}>The celebration of</p>
          <h1>
            {brideName} <i>&amp;</i> {groomName}
          </h1>
          <p className={s.meta}>
            <time dateTime={wedding.weddingDate}>
              {dayLabel(wedding.weddingDate + "T00:00:00+05:30")}
            </time>
            <span aria-hidden="true"> · </span>
            {wedding.location}
          </p>
          <div className={s.ornament} aria-hidden="true">
            ✧
          </div>
          {wedding.introduction && (
            <p className={s.intro}>{wedding.introduction}</p>
          )}
          <div className={s.actions}>
            <a href="#schedule" className={s.primary}>
              View schedule
            </a>
            {wedding.livestream && (
              <a href="#ceremony" className={s.secondary}>
                Watch the ceremony
              </a>
            )}
          </div>
        </header>
        <PublicSchedule
          key={wedding.slug}
          endpoint={wedding.eventsUrl}
          initial={schedule}
        />
        {wedding.livestream && (
          <section id="ceremony" className={s.stream}>
            <h2>Watch the ceremony</h2>
            <iframe
              loading="lazy"
              title={`Wedding ceremony for ${names}`}
              src={wedding.livestream.embedUrl}
              referrerPolicy="strict-origin-when-cross-origin"
              allow="encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
            <a className={s.secondary} href={wedding.livestream.watchUrl}>
              Open on YouTube ↗
            </a>
            <p className={s.caption}>
              Use this link if the player is unavailable.
            </p>
          </section>
        )}
        <footer className={s.signature}>With affection, {names}</footer>
      </main>
      <footer className={s.foot}>
        <Link href="/">Make My Marriage</Link>
      </footer>
    </div>
  );
}
