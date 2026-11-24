import Link from "next/link";
import type { ComponentProps } from "react";
import { notFound, redirect } from "next/navigation";
import { currentAccount } from "@/lib/access/account";
import { emailVerificationSatisfied } from "@/lib/access/email-verification";
import { AppError } from "@/lib/http/errors";
import { getWedding, weddingForMember } from "@/modules/weddings/service";
import {
  listMembers,
  listMemberInvitations,
} from "@/modules/weddings/team-service";
import { OnboardingShell } from "@/modules/weddings/components/onboarding-shell";
import { SetupUnavailable } from "@/modules/weddings/components/onboarding-controls";
import { PlanningTeam } from "@/modules/weddings/components/planning-team";
import type { MemberRole } from "@/modules/weddings/schemas";
export const metadata = { title: "Planning team" };
export default async function TeamPage({
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
  let teamProps: ComponentProps<typeof PlanningTeam> | undefined;
  let failure: AppError | undefined;
  try {
    const wedding = await getWedding(actor, weddingId);
    const access = await weddingForMember(actor, weddingId);
    const admin =
      access.isOwner || ["bride", "groom"].includes(access.membership.role);
    const members = await listMembers(actor, weddingId, { status: "active" });
    const invitations = admin
      ? await listMemberInvitations(actor, weddingId)
      : null;
    teamProps = {
      wedding,
      currentUserId: actor.id,
      currentRole: access.membership.role as MemberRole,
      isOwner: access.isOwner,
      initialMembers: members,
      initialInvitations: invitations,
    };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if ([400, 404].includes(error.status)) notFound();
    if (error.status === 401) redirect("/login");
    failure = error;
  }
  return (
    <OnboardingShell email={account.emailNormalized}>
      {failure ? (
        failure.status === 503 ? (
          <SetupUnavailable message={failure.message} />
        ) : (
          <section>
            <h1>Your wedding access has changed.</h1>
            <p>{failure.message}</p>
            <Link href="/onboarding">Back to your account</Link>
          </section>
        )
      ) : teamProps ? (
        <PlanningTeam
          key={`${teamProps.wedding.id}:${teamProps.currentUserId}:${teamProps.currentRole}:${teamProps.isOwner}`}
          {...teamProps}
        />
      ) : null}
    </OnboardingShell>
  );
}
