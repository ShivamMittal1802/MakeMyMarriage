import { LandingPage } from "@/components/landing/landing-page";
import type { LandingAccount } from "@/components/landing/landing-controls";
import { currentUserDto } from "@/lib/access/account";
import { AppError } from "@/lib/http/errors";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let account: LandingAccount;
  try {
    const user = await currentUserDto();
    account = {
      email: user.email,
      weddingId: user.membership?.weddingId ?? null,
    };
  } catch (error) {
    // The public landing page remains usable without account services.
    account =
      error instanceof AppError && error.status === 401 ? null : "unavailable";
  }
  return <LandingPage account={account} />;
}
