import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { api, readJson, success } from "@/lib/http/api";
import { AppError } from "@/lib/http/errors";
import { currentActor } from "@/lib/access/actor";
import { assertCsrf } from "@/lib/security/csrf";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { purposeSchema, uploadSchema } from "./schema";
import {
  photoActor,
  exchangeGallery,
  setGalleryCookie,
  galleryAccess,
} from "./access";
import {
  listPhotos,
  getPhoto,
  initiate,
  complete,
  uploadStatus,
  deletePhoto,
} from "./service";
type Context = {
  params: Promise<{ weddingId: string; photoId?: string; purpose?: string }>;
};
async function writer(r: NextRequest, w: string, purpose: "upload" | "view") {
  assertCsrf(r);
  const actor = await photoActor(r, w, purpose);
  await consumeRateLimit(
    "photo-write",
    "member" in actor ? actor.member.id : actor.grant.accessId,
    120,
    900_000,
  );
  return actor;
}
export const access = (_r: NextRequest, c: Context) =>
  api(async () =>
    success(
      await galleryAccess(await currentActor(), (await c.params).weddingId),
    ),
  );
export const share = (r: NextRequest, c: Context) =>
  api(async () => {
    assertCsrf(r);
    await readJson(r, z.strictObject({}));
    const p = await c.params,
      purpose = purposeSchema.safeParse(p.purpose);
    if (!purpose.success)
      throw new AppError(
        404,
        "NOT_FOUND",
        "This photo link type is unavailable.",
      );
    const a = await currentActor();
    await consumeRateLimit("gallery-share", a.id, 30, 900_000);
    return success(await galleryAccess(a, p.weddingId, purpose.data));
  });
export const exchange = (r: NextRequest) =>
  api(async () => {
    assertCsrf(r);
    const data = await readJson(
      r,
      z.strictObject({
        token: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
        purpose: purposeSchema,
      }),
    );
    await consumeRateLimit("gallery-exchange", data.token, 30, 900_000);
    const grant = await exchangeGallery(data.token, data.purpose),
      cleanPath = `/gallery/${data.purpose}/${grant.weddingId}`;
    const response = success({
      weddingId: grant.weddingId,
      purpose: grant.purpose,
      cleanPath,
    });
    await setGalleryCookie(response, grant);
    return response;
  });
export const list = (r: NextRequest, c: Context) =>
  api(async () => {
    const { weddingId: w } = await c.params;
    return NextResponse.json(
      await listPhotos(
        await photoActor(r, w, "view"),
        w,
        Object.fromEntries(r.nextUrl.searchParams),
      ),
    );
  });
export const get = (r: NextRequest, c: Context) =>
  api(async () => {
    const p = await c.params;
    return success(
      await getPhoto(
        await photoActor(r, p.weddingId, "view"),
        p.weddingId,
        p.photoId!,
      ),
    );
  });
export const download = (r: NextRequest, c: Context) =>
  api(async () => {
    const p = await c.params;
    await readJson(r, z.strictObject({}));
    return success(
      await getPhoto(
        await writer(r, p.weddingId, "view"),
        p.weddingId,
        p.photoId!,
        true,
      ),
    );
  });
export const create = (r: NextRequest, c: Context) =>
  api(async () => {
    const p = await c.params;
    const result = await initiate(
      await writer(r, p.weddingId, "upload"),
      p.weddingId,
      r.headers.get("idempotency-key") ?? "",
      await readJson(r, uploadSchema),
    );
    const response = success(result.ticket, result.replay ? 200 : 201);
    if (!result.replay)
      response.headers.set("Location", result.ticket.statusUrl);
    return response;
  });
export const getStatus = (r: NextRequest, c: Context) =>
  api(async () => {
    const p = await c.params;
    return success(
      await uploadStatus(
        await photoActor(r, p.weddingId, "upload"),
        p.weddingId,
        p.photoId!,
      ),
    );
  });
export const finish = (r: NextRequest, c: Context) =>
  api(async () => {
    const p = await c.params;
    await readJson(r, z.strictObject({}));
    const result = await complete(
      await writer(r, p.weddingId, "upload"),
      p.weddingId,
      p.photoId!,
    );
    return success(result, result.state === "processing" ? 202 : 200);
  });
export const remove = (r: NextRequest, c: Context) =>
  api(async () => {
    assertCsrf(r);
    const p = await c.params,
      value = r.nextUrl.searchParams.get("expectedVersion"),
      version = z.coerce
        .number()
        .int()
        .nonnegative()
        .safeParse(value ?? undefined);
    if (!version.success)
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Supply the current photo version.",
      );
    const result = await deletePhoto(
      await currentActor(),
      p.weddingId,
      p.photoId!,
      version.data,
    );
    return result
      ? success(result, 202)
      : new NextResponse(null, { status: 204 });
  });
