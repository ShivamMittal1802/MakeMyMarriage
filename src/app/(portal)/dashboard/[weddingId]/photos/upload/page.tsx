import { MemberPhotoPage } from "@/modules/gallery/member-page";
export default function Page({
  params,
}: {
  params: Promise<{ weddingId: string }>;
}) {
  return <MemberPhotoPage params={params} upload />;
}
