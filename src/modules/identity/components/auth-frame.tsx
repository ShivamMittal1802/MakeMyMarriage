import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./auth.module.css";

export function AuthFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          Make My Marriage<span>•</span>
        </Link>
        <span className={styles.headerNote}>
          A little less coordination. A lot more celebration.
        </span>
      </header>
      <div className={styles.card}>
        <aside className={styles.visual} aria-label="Wedding inspiration">
          <Image
            src="/images/landing/wedding-gallery.jpg"
            alt="A couple celebrating their wedding together"
            fill
            sizes="(max-width: 800px) 100vw, 50vw"
            priority
          />
          <div className={styles.visualCopy}>
            <span className={styles.eyebrow}>For your next chapter</span>
            <h2>
              Your wedding,
              <br />
              beautifully organised.
            </h2>
            <p>One shared space for you and the people helping you plan.</p>
          </div>
        </aside>
        <section className={styles.content} aria-labelledby="auth-title">
          <Link href="/" className={styles.innerBrand}>
            Make My Marriage<span>•</span>
          </Link>
          <h1 id="auth-title">{title}</h1>
          <p className={styles.description}>{description}</p>
          {children}
          <aside className={styles.guestNotice}>
            <strong>Here as a guest?</strong>
            <p>
              To RSVP or share photos, use the private link shared with you. No
              account needed.
            </p>
          </aside>
        </section>
      </div>
      <footer className={styles.footer}>
        Made for the moments that matter · <Link href="/">Back to home</Link>
      </footer>
    </main>
  );
}
