import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { NextRequest } from "next/server";
import { AppError } from "@/lib/http/errors";
import { appOrigin } from "@/lib/config/server";
import { storageConfigured } from "@/lib/providers/r2";
import { photoActor } from "@/modules/gallery/access";
import { purposeSchema } from "@/modules/gallery/schema";
import {
  PhotoShell,
  PhotoExchange,
  PhotoUpload,
  PhotoGallery,
} from "@/modules/gallery/workspace";
import { Wedding } from "@/modules/weddings/models";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ purpose: string; key: string }>;
}) {
  const p = await params,
    purpose = purposeSchema.safeParse(p.purpose);
  if (!purpose.success) notFound();
  if (p.key === "access")
    return (
      <PhotoShell>
        <PhotoExchange purpose={purpose.data} />
      </PhotoShell>
    );
  let props;
  try {
    await photoActor(
      new NextRequest(appOrigin() + "/gallery", { headers: await headers() }),
      p.key,
      purpose.data,
    );
    const wedding = await Wedding.findById(p.key).lean();
    if (!wedding?.couple) notFound();
    props = {
      w: p.key,
      couple: `${wedding.couple.brideName} & ${wedding.couple.groomName}`,
      configured: storageConfigured(),
    };
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return (
      <PhotoShell>
        {
          <section style={{ maxWidth: 600, padding: 30, margin: "60px auto" }}>
            <h1>Private photo access unavailable</h1>
            <p>{e.message}</p>
            <p>Ask the couple for a current {purpose.data} link.</p>
          </section>
        }
      </PhotoShell>
    );
  }
  return (
    <PhotoShell>
      {purpose.data === "upload" ? (
        <PhotoUpload {...props} />
      ) : (
        <PhotoGallery {...props} />
      )}
    </PhotoShell>
  );
}
