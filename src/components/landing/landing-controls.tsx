"use client";

import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./landing-icons";
import styles from "./landing.module.css";

type AccountAction = "create" | "login";
const AccountContext = createContext<((action: AccountAction) => void) | null>(
  null,
);

export function LandingInteractions({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [action, setAction] = useState<AccountAction>("create");
  function openAccountNotice(nextAction: AccountAction) {
    setAction(nextAction);
    dialog.current?.showModal();
  }
  return (
    <AccountContext value={openAccountNotice}>
      {children}
      <dialog
        ref={dialog}
        className={styles.accountDialog}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.close();
        }}
      >
        <form method="dialog">
          <button className={styles.dialogClose} aria-label="Close message">
            <Icon name="close" />
          </button>
          <span className={styles.dialogEmblem}>
            <Icon name="heart" />
          </span>
          <p className={styles.eyebrow}>Something lovely is on its way</p>
          <h2 id={titleId}>
            {action === "create"
              ? "Your wedding starts here. Soon."
              : "We’ll be ready to welcome you soon."}
          </h2>
          <p id={descriptionId}>
            Account creation and sign-in are coming next. For now, explore how
            Make My Marriage will bring your wedding plans together.
          </p>
          <button className={`${styles.button} ${styles.primary}`}>
            Keep exploring
          </button>
        </form>
      </dialog>
    </AccountContext>
  );
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
  const open = useContext(AccountContext);
  return (
    <button
      type="button"
      className={`${styles.button} ${styles[variant]} ${className}`}
      onClick={() => open?.(action)}
      aria-label={label}
    >
      {children}
    </button>
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
  const openAccount = useContext(AccountContext);
  function accountFromMenu(action: AccountAction) {
    menu.current?.close();
    openAccount?.(action);
  }
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
          <button type="button" onClick={() => accountFromMenu("login")}>
            Log in
          </button>
        </nav>
        <button
          type="button"
          className={`${styles.button} ${styles.primary} ${styles.menuCta}`}
          onClick={() => accountFromMenu("create")}
        >
          Create your wedding
        </button>
      </dialog>
    </header>
  );
}
