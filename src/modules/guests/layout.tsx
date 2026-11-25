import type { ReactNode } from "react";
import Link from "next/link";
import { AccountMenu } from "@/modules/weddings/components/onboarding-controls";
import g from "./guests.module.css";
export function GuestLayout({
  w,
  email,
  children,
}: {
  w: string;
  email: string;
  children: ReactNode;
}) {
  const home = "/dashboard/" + w;
  return (
    <div className={g.shell}>
      <a href="#guest-content" className={g.skip}>
        Skip to guests
      </a>
      <header className={g.header}>
        <Link href="/" className={g.brand}>
          Make My Marriage
        </Link>
        <Link className={g.breadcrumb} href={home}>
          My wedding / Guests
        </Link>
        <nav aria-label="Wedding management">
          <Link href={home + "/events"}>Events</Link>
          <Link href={home + "/team"}>Planning Team</Link>
          <Link aria-current="page" href={home + "/guests"}>
            Guests
          </Link>
        </nav>
        <AccountMenu email={email} />
      </header>
      <main id="guest-content" className={g.main}>
        {children}
      </main>
      <footer className={g.footer}>
        <Link href="/" className={g.brand}>
          Make My Marriage
        </Link>
        <span>© {new Date().getFullYear()} Make My Marriage</span>
        <Link href={home}>My wedding</Link>
      </footer>
    </div>
  );
}
