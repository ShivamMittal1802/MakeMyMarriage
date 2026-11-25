import { redirect, notFound } from "next/navigation";
import { currentAccount } from "@/lib/access/account";
import { emailVerificationSatisfied } from "@/lib/access/email-verification";
import { AppError } from "@/lib/http/errors";
import { storageConfigured } from "@/lib/providers/r2";
import { getWedding } from "@/modules/weddings/service";
import { GuestLayout } from "@/modules/guests/layout";
import { SetupUnavailable } from "@/modules/weddings/components/onboarding-controls";
import { PhotoGallery, PhotoUpload } from "./workspace";
export async function MemberPhotoPage({
  params,
  upload = false,
}: {
  params: Promise<{ weddingId: string }>;
  upload?: boolean;
}) {
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (!emailVerificationSatisfied(account)) redirect("/onboarding");
  const { weddingId: w } = await params;
  let props;
  try {
    const wedding = await getWedding(
      { id: String(account._id), sessionVersion: account.sessionVersion },
      w,
    );
    props = {
      w,
      member: true,
      couple: `${wedding.couple.brideName} & ${wedding.couple.groomName}`,
      configured: storageConfigured(),
    };
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    if (e.status === 401) redirect("/login");
    if (e.status === 404) notFound();
    return (
      <GuestLayout w={w} email={account.emailNormalized} active="photos">
        <SetupUnavailable message={e.message} />
      </GuestLayout>
    );
  }
  return (
    <GuestLayout w={w} email={account.emailNormalized} active="photos">
      {upload ? <PhotoUpload {...props} /> : <PhotoGallery {...props} />}
    </GuestLayout>
  );
}
