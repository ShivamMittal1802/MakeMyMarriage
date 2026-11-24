"use client";

import { useId, useRef, type ReactNode } from "react";
import Link from "next/link";
import { Icon } from "./landing-icons";
import styles from "./landing.module.css";

type AccountAction = "create" | "login";
export function LandingInteractions({ children }: { children: ReactNode }) {
  return children;
}

export function AccountButton({
  children,
  action = "create",
  variant = "primary",
  className = "",
  label,
}: {
  children: ReactNode;
  action?: AccountAction;
  variant?: "primary" | "light" | "text";
  className?: string;
  label?: string;
}) {
  return (
    <Link
      href={action === "login" ? "/login" : "/register"}
      className={`${styles.button} ${styles[variant]} ${className}`}
      aria-label={label}
    >
      {children}
    </Link>
  );
}

const navigation = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#faqs", label: "FAQs" },
];

export function LandingHeader() {
  const menu = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <header className={styles.header}>
      <div className={`${styles.container} ${styles.headerInner}`}>
        <a
          href="#top"
          className={styles.brand}
          aria-label="Make My Marriage home"
        >
          Make My Marriage
        </a>
        <nav aria-label="Main navigation" className={styles.desktopNav}>
          {navigation.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className={styles.desktopActions}>
          <AccountButton action="login" variant="text">
            Log in
          </AccountButton>
          <AccountButton>Create your wedding</AccountButton>
        </div>
        <div className={styles.mobileActions}>
          <AccountButton
            action="login"
            className={styles.profileButton}
            label="Log in"
          >
            <Icon name="user" />
          </AccountButton>
          <button
            className={styles.iconButton}
            type="button"
            aria-label="Open navigation menu"
            aria-haspopup="dialog"
            onClick={() => menu.current?.showModal()}
          >
            <Icon name="menu" />
          </button>
        </div>
      </div>
      <dialog
        ref={menu}
        className={styles.mobileMenu}
        aria-labelledby={titleId}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.close();
        }}
      >
        <div className={styles.menuTop}>
          <span id={titleId} className={styles.brand}>
            Make My Marriage
          </span>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Close navigation menu"
            onClick={() => menu.current?.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <nav aria-label="Mobile navigation">
          {navigation.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => menu.current?.close()}
            >
              {item.label}
            </a>
          ))}
          <Link href="/login" onClick={() => menu.current?.close()}>
            Log in
          </Link>
        </nav>
        <Link
          href="/register"
          className={`${styles.button} ${styles.primary} ${styles.menuCta}`}
          onClick={() => menu.current?.close()}
        >
          Create your wedding
        </Link>
      </dialog>
    </header>
  );
}
