import { currentAccount } from "@/lib/access/account";
import { OnboardingShell } from "@/modules/weddings/components/onboarding-shell";
import { InvitationExchange } from "@/modules/weddings/components/invitation-flow";
export const metadata = { title: "Your wedding invitation" };
export default async function Page() {
  const account = await currentAccount();
  return (
    <OnboardingShell email={account?.emailNormalized}>
      <InvitationExchange />
    </OnboardingShell>
  );
}
