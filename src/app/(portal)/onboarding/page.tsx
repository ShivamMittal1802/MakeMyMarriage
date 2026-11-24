import { redirect } from "next/navigation";
import { currentAccount } from "@/lib/access/account";
import { emailVerificationSatisfied } from "@/lib/access/email-verification";
import { appOrigin, identityConfigured } from "@/lib/config/server";
import { AppError } from "@/lib/http/errors";
import { activeMembership } from "@/modules/weddings/service";
import { pendingInvitationId } from "@/modules/weddings/invitation-grants";
import { OnboardingShell } from "@/modules/weddings/components/onboarding-shell";
import {
  VerificationRequired,
  SetupUnavailable,
} from "@/modules/weddings/components/onboarding-controls";
import { OnboardingWizard } from "@/modules/weddings/components/onboarding-wizard";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Wedding onboarding",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ skipInvitation?: string | string[] }>;
}) {
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (!emailVerificationSatisfied(account))
    return (
      <OnboardingShell email={account.emailNormalized}>
        <VerificationRequired
          email={account.emailNormalized}
          configured={identityConfigured()}
        />
      </OnboardingShell>
    );
  const { skipInvitation } = await searchParams;
  const invitationId =
    skipInvitation === "1" ? null : await pendingInvitationId();
  if (invitationId) redirect(`/join/${invitationId}`);
  let membership;
  try {
    membership = await activeMembership({
      id: String(account._id),
      sessionVersion: account.sessionVersion,
    });
  } catch (error) {
    if (error instanceof AppError && error.status === 503)
      return (
        <OnboardingShell email={account.emailNormalized}>
          <SetupUnavailable message={error.message} />
        </OnboardingShell>
      );
    throw error;
  }
  if (membership) redirect(`/dashboard/${membership.weddingId}`);
  return (
    <OnboardingShell email={account.emailNormalized}>
      <OnboardingWizard origin={appOrigin()} email={account.emailNormalized} />
    </OnboardingShell>
  );
}
