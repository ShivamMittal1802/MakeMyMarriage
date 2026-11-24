import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { currentAccount } from "@/lib/access/account";
import { emailVerificationSatisfied } from "@/lib/access/email-verification";
import { AppError } from "@/lib/http/errors";
import { getWedding, weddingForMember } from "@/modules/weddings/service";
import { OnboardingShell } from "@/modules/weddings/components/onboarding-shell";
import { SetupUnavailable } from "@/modules/weddings/components/onboarding-controls";
import { roleLabels, displayDate } from "@/modules/weddings/format";
import styles from "@/modules/weddings/components/onboarding.module.css";
export const metadata = { title: "Your wedding" };
export default async function Page({
  params,
}: {
  params: Promise<{ weddingId: string }>;
}) {
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (!emailVerificationSatisfied(account)) redirect("/onboarding");
  const { weddingId } = await params;
  const actor = {
    id: String(account._id),
    sessionVersion: account.sessionVersion,
  };
  let wedding, access;
  try {
    wedding = await getWedding(actor, weddingId);
    access = await weddingForMember(actor, weddingId);
  } catch (error) {
    if (error instanceof AppError && error.status === 503)
      return (
        <OnboardingShell email={account.emailNormalized}>
          <SetupUnavailable message={error.message} />
        </OnboardingShell>
      );
    if (error instanceof AppError && [400, 404].includes(error.status))
      notFound();
    throw error;
  }
  return (
    <OnboardingShell email={account.emailNormalized}>
      <section className={styles.dashboard}>
        <p className={styles.eyebrow}>Your shared wedding space</p>
        <h1>
          {wedding.couple.brideName} &amp; {wedding.couple.groomName}
        </h1>
        <p>Welcome, {account.name}. Your celebration starts here.</p>
        <div className={styles.weddingCard}>
          <div>
            <h2>The celebration</h2>
            <p>{displayDate(wedding.weddingDate)}</p>
            <p>{wedding.location}</p>
          </div>
          <div>
            <p>
              Your role:{" "}
              <strong>
                {roleLabels[access.membership.role as keyof typeof roleLabels]}
              </strong>{" "}
              {access.isOwner && <span className={styles.badge}>Owner</span>}
            </p>
            <p className={styles.small}>Wedding website address</p>
            <p className={styles.breakText}>{wedding.publicUrl}</p>
          </div>
          {wedding.introduction && (
            <p className={styles.fullWidth}>{wedding.introduction}</p>
          )}
        </div>
        <p className={styles.notice}>
          Your wedding details and planning-team invitations are ready. Events,
          guest invitations, expenses, the public website, and photos will be
          added in the next development steps.
        </p>
        <section id="planning-team" className={styles.teamSection}>
          <h2>Bring your people into the planning.</h2>
          <p>
            View your planning team. The owner, bride, and groom can invite
            people and manage membership.
          </p>
          <Link
            className={styles.primary}
            href={`/dashboard/${wedding.id}/team`}
          >
            Open planning team
          </Link>
        </section>
      </section>
    </OnboardingShell>
  );
}
