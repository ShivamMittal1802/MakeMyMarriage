import type { ReactNode } from "react";
import Link from "next/link";
import { AccountMenu } from "@/modules/weddings/components/onboarding-controls";
import g from "./guests.module.css";
export function GuestLayout({
  w,
  email,
  children,
  active = "guests",
}: {
  w: string;
  email: string;
  children: ReactNode;
  active?: "guests" | "expenses" | "photos";
}) {
  const home = "/dashboard/" + w;
  return (
    <div className={g.shell}>
      <a href="#guest-content" className={g.skip}>
        Skip to content
      </a>
      <header className={g.header}>
        <Link href="/" className={g.brand}>
          Make My Marriage
        </Link>
        <Link className={g.breadcrumb} href={home}>
          My wedding /{" "}
          {active === "guests"
            ? "Guests"
            : active === "expenses"
              ? "Expenses"
              : "Photos"}
        </Link>
        <nav aria-label="Wedding management">
          <Link href={home + "/events"}>Events</Link>
          <Link href={home + "/team"}>Planning Team</Link>
          <Link
            aria-current={active === "guests" ? "page" : undefined}
            href={home + "/guests"}
          >
            Guests
          </Link>
          <Link
            aria-current={active === "expenses" ? "page" : undefined}
            href={home + "/expenses"}
          >
            Expenses
          </Link>
          <Link
            aria-current={active === "photos" ? "page" : undefined}
            href={home + "/photos"}
          >
            Photos
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
