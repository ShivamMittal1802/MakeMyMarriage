import Link from "next/link";
import { redirect } from "next/navigation";
import { currentAccount } from "@/lib/access/account";
import { identityConfigured } from "@/lib/config/server";
import {
  AuthForm,
  SignOutButton,
} from "@/modules/identity/components/auth-form";
import styles from "@/modules/identity/components/auth.module.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};
export default async function OnboardingPage() {
  const user = await currentAccount();
  if (!user) redirect("/login");
  return (
    <main className={styles.account}>
      <Link href="/" className={styles.brand}>
        Make My Marriage
      </Link>
      <h1>Welcome, {user.name}.</h1>
      <p>You’re logged in as {user.emailNormalized}.</p>
      {user.emailVerifiedAt ? (
        <p>
          Your email is verified. Wedding setup and invitations to your planning
          team are the next features we’re building.
        </p>
      ) : (
        <>
          <p>
            Check your inbox and verify your email before creating or joining a
            wedding.
          </p>
          <AuthForm
            action="resend-verification"
            email={user.emailNormalized}
            configured={identityConfigured()}
          />
        </>
      )}
      <SignOutButton />
    </main>
  );
}
