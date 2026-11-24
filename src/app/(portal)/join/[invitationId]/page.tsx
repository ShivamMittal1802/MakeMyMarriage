import type { ComponentProps } from "react";
import Link from "next/link";
import { currentAccount } from "@/lib/access/account";
import { emailVerificationSatisfied } from "@/lib/access/email-verification";
import { AppError } from "@/lib/http/errors";
import { readInvitationGrant } from "@/modules/weddings/invitation-grants";
import {
  activeMembership,
  invitationContext,
} from "@/modules/weddings/service";
import { OnboardingShell } from "@/modules/weddings/components/onboarding-shell";
import { JoinInvitation } from "@/modules/weddings/components/invitation-flow";
import { SetupUnavailable } from "@/modules/weddings/components/onboarding-controls";
import styles from "@/modules/weddings/components/onboarding.module.css";
export const metadata = { title: "Join the planning team" };
export default async function Page({
  params,
}: {
  params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  const account = await currentAccount();
  const actor = account
    ? { id: String(account._id), sessionVersion: account.sessionVersion }
    : undefined;
  let joinProps: ComponentProps<typeof JoinInvitation> | undefined;
  let failure: AppError | undefined;
  try {
    const grant = await readInvitationGrant(invitationId);
    const details = await invitationContext(grant, actor);
    const membership =
      actor && account && emailVerificationSatisfied(account)
        ? await activeMembership(actor)
        : null;
    const mode = !account
      ? "logged-out"
      : !details.matchesEmail
        ? "wrong-email"
        : !emailVerificationSatisfied(account)
          ? "verify"
          : details.accepted
            ? "accepted"
            : membership
              ? "existing-member"
              : "eligible";
    joinProps = {
      context: details.context,
      mode,
      weddingId: details.accepted
        ? grant.weddingId
        : membership
          ? String(membership.weddingId)
          : undefined,
    };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    failure = error;
  }
  return (
    <OnboardingShell email={account?.emailNormalized}>
      {failure ? (
        failure.status === 503 ? (
          <SetupUnavailable message={failure.message} />
        ) : (
          <section className={styles.centerCard}>
            <h1>This invitation is unavailable.</h1>
            <p>{failure.message}</p>
            <p>Ask the organiser for a fresh private link.</p>
            <div className={styles.stackedActions}>
              <Link
                className={styles.primary}
                href="/onboarding?skipInvitation=1"
              >
                Back to your account
              </Link>
            </div>
          </section>
        )
      ) : joinProps ? (
        <JoinInvitation {...joinProps} />
      ) : null}
    </OnboardingShell>
  );
}
