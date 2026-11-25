import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { currentAccount } from "@/lib/access/account";
import { emailVerificationSatisfied } from "@/lib/access/email-verification";
import { AppError } from "@/lib/http/errors";
import { OnboardingShell } from "@/modules/weddings/components/onboarding-shell";
import { SetupUnavailable } from "@/modules/weddings/components/onboarding-controls";
import { listEvents } from "@/modules/events/service";
import { Schedule } from "@/modules/events/schedule";
export const metadata = { title: "Wedding events" };
export default async function Page({
  params,
}: {
  params: Promise<{ weddingId: string }>;
}) {
  const { weddingId } = await params;
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (!emailVerificationSatisfied(account)) redirect("/onboarding");
  let list;
  try {
    list = await listEvents(
      { id: String(account._id), sessionVersion: account.sessionVersion },
      weddingId,
    );
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    if (e.status === 401) redirect("/login");
    if (e.status === 403) redirect("/onboarding");
    if ([400, 404].includes(e.status)) notFound();
    return (
      <OnboardingShell email={account.emailNormalized}>
        <SetupUnavailable message="Couldn’t load the wedding schedule. Please try again." />
        <Link href={`/dashboard/${weddingId}`}>Back to my wedding</Link>
      </OnboardingShell>
    );
  }
  return (
    <OnboardingShell email={account.emailNormalized}>
      <Schedule key={weddingId} weddingId={weddingId} initial={list} />
    </OnboardingShell>
  );
}
