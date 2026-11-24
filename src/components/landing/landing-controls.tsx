"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Icon } from "./landing-icons";
import styles from "./landing.module.css";

type AccountAction = "create" | "login";
export type LandingAccount =
  { email: string; weddingId: string | null } | null | "unavailable";
const AccountContext = createContext<LandingAccount>(null);

function accountDestination(account: LandingAccount) {
  return account && account !== "unavailable" && account.weddingId
    ? `/dashboard/${account.weddingId}`
    : "/onboarding";
}
function accountActionLabel(account: LandingAccount) {
  return account === "unavailable"
    ? "Your account"
    : account?.weddingId
      ? "My wedding"
      : "Continue setup";
}
export function LandingInteractions({
  account,
  children,
}: {
  account: LandingAccount;
  children: ReactNode;
}) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => router.refresh();
    // Back/forward navigation may restore an older Router Cache entry after
    // login or wedding creation. Reconcile it once when this page mounts.
    refresh();
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", restored);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", restored);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [router]);
  return <AccountContext value={account}>{children}</AccountContext>;
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
  const account = useContext(AccountContext);
  const personalised = account !== null;
  return (
    <Link
      href={
        personalised
          ? accountDestination(account)
          : action === "login"
            ? "/login"
            : "/register"
      }
      className={`${styles.button} ${styles[variant]} ${className}`}
      aria-label={personalised ? undefined : label}
    >
      {personalised
        ? action === "login"
          ? "My account"
          : accountActionLabel(account)
        : children}
    </Link>
  );
}

function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function logout() {
    setPending(true);
    setError(false);
    try {
      await signOut({ redirectTo: "/" });
    } catch {
      setError(true);
      setPending(false);
    }
  }
  return (
    <>
      <button
        className={styles.logoutButton}
        type="button"
        disabled={pending}
        onClick={() => void logout()}
      >
        {pending ? "Logging out…" : "Log out"}
      </button>
      {error && (
        <p className={styles.accountError} role="alert">
          Unable to log out. Please try again.
        </p>
      )}
    </>
  );
}

function AccountDropdown({
  account,
}: {
  account: Exclude<LandingAccount, null>;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const email = account === "unavailable" ? undefined : account.email;
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !menu.current?.contains(event.target))
        menu.current?.removeAttribute("open");
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return (
    <details
      ref={menu}
      className={styles.accountMenu}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current?.open) {
          event.preventDefault();
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label="Account menu">
        <Icon name="user" />
        <span className={styles.accountEmail}>{email ?? "Account"}</span>
        <Icon name="chevron" />
      </summary>
      <div className={styles.accountPanel}>
        {email ? (
          <p>
            Signed in as <strong>{email}</strong>
          </p>
        ) : (
          <p>Account details are temporarily unavailable.</p>
        )}
        <Link href={accountDestination(account)}>
          {accountActionLabel(account)}
        </Link>
        <LogoutButton />
      </div>
    </details>
  );
}

const navigation = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#faqs", label: "FAQs" },
];

export function LandingHeader() {
  const account = useContext(AccountContext);
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
          {account ? (
            <AccountDropdown account={account} />
          ) : (
            <AccountButton action="login" variant="text">
              Log in
            </AccountButton>
          )}
          <AccountButton>Create your wedding</AccountButton>
        </div>
        <div className={styles.mobileActions}>
          {account ? (
            <AccountDropdown account={account} />
          ) : (
            <AccountButton
              action="login"
              className={styles.profileButton}
              label="Log in"
            >
              <Icon name="user" />
            </AccountButton>
          )}
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
          {account ? (
            <div className={styles.mobileAccount}>
              {account !== "unavailable" && <p>{account.email}</p>}
              <Link
                href={accountDestination(account)}
                onClick={() => menu.current?.close()}
              >
                {accountActionLabel(account)}
              </Link>
              <LogoutButton />
            </div>
          ) : (
            <Link href="/login" onClick={() => menu.current?.close()}>
              Log in
            </Link>
          )}
        </nav>
        <Link
          href={account ? accountDestination(account) : "/register"}
          className={`${styles.button} ${styles.primary} ${styles.menuCta}`}
          onClick={() => menu.current?.close()}
        >
          {account ? accountActionLabel(account) : "Create your wedding"}
        </Link>
      </dialog>
    </header>
  );
}
