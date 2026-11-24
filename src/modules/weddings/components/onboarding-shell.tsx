import Link from "next/link";
import type { ReactNode } from "react";
import { AccountMenu } from "./onboarding-controls";
import styles from "./onboarding.module.css";
export function OnboardingShell({
  children,
  email,
}: {
  children: ReactNode;
  email?: string;
}) {
  return (
    <div className={styles.page}>
      <a href="#onboarding-content" className={styles.skip}>
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand}>
            Make My Marriage
          </Link>
          {email ? (
            <AccountMenu email={email} />
          ) : (
            <Link href="/login" className={styles.textButton}>
              Log in
            </Link>
          )}
        </div>
      </header>
      <main id="onboarding-content" className={styles.main} tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
