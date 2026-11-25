import "server-only";
import { encode, decode } from "next-auth/jwt";
import { z } from "zod";
import type { NextRequest, NextResponse } from "next/server";
import type { ClientSession } from "mongoose";
import { currentAccount } from "@/lib/access/account";
import { appOrigin, authSecret } from "@/lib/config/server";
import { ensureWeddingDatabase } from "@/lib/db/wedding-readiness";
import { AppError } from "@/lib/http/errors";
import { tokenHash } from "@/lib/security/crypto";
import { recoverToken } from "@/lib/security/token-envelope";
import {
  weddingForMember,
  type AccountActor,
} from "@/modules/weddings/service";
import { objectIdSchema } from "@/modules/weddings/schemas";
import { GalleryAccess } from "./access-model";
import { purposeSchema, type Purpose } from "./schema";
const grantSchema = z.object({
  weddingId: objectIdSchema,
  accessId: objectIdSchema,
  purpose: purposeSchema,
  generation: z.number().int().nonnegative(),
});
type Grant = z.infer<typeof grantSchema>;
export type PhotoActor = { member: AccountActor } | { grant: Grant };
const cookieName = (w: string, p: Purpose) =>
  `${appOrigin().startsWith("https:") ? "__Host-" : ""}mmm.gallery.${p}.${w}`;
export const unavailable = () =>
  new AppError(
    404,
    "NOT_FOUND",
    "This private photo link is unavailable. Ask the couple for a current link.",
  );
export async function authorize(
  actor: PhotoActor,
  weddingId: string,
  purpose: Purpose,
  session?: ClientSession,
) {
  await ensureWeddingDatabase();
  if ("member" in actor) {
    await weddingForMember(actor.member, weddingId, session, false, !!session);
    return;
  }
  const g = actor.grant;
  if (g.weddingId !== weddingId || g.purpose !== purpose) throw unavailable();
  const filter = {
    _id: g.accessId,
    weddingId,
    purpose,
    status: "active" as const,
    "token.version": g.generation,
  };
  // Fence mutations against concurrent access revocation without changing token generation.
  const row = session
    ? await GalleryAccess.findOneAndUpdate(
        filter,
        { $inc: { version: 1 } },
        { session },
      )
    : await GalleryAccess.findOne(filter);
  if (!row) throw unavailable();
}
export async function photoActor(
  request: NextRequest,
  weddingId: string,
  purpose: Purpose,
): Promise<PhotoActor> {
  if (!objectIdSchema.safeParse(weddingId).success) throw unavailable();
  const name = cookieName(weddingId, purpose),
    token = request.cookies.get(name)?.value;
  if (token) {
    const value = await decode({
        token,
        secret: authSecret(),
        salt: name,
      }).catch(() => null),
      result = grantSchema.safeParse(value);
    if (
      result.success &&
      typeof value?.exp === "number" &&
      value.exp > Date.now() / 1000
    ) {
      const actor = { grant: result.data };
      await authorize(actor, weddingId, purpose);
      return actor;
    }
  }
  const account = await currentAccount();
  if (account) {
    const actor = {
      member: {
        id: String(account._id),
        sessionVersion: account.sessionVersion,
      },
    };
    await authorize(actor, weddingId, purpose);
    return actor;
  }
  throw new AppError(
    401,
    "ACCESS_GRANT_REQUIRED",
    "Reopen your original private photo link to continue.",
  );
}
export async function exchangeGallery(token: string, purpose: Purpose) {
  await ensureWeddingDatabase();
  const row = await GalleryAccess.findOne({
    "token.hash": tokenHash(token),
    purpose,
    status: "active",
  }).select("+token");
  if (!row) throw unavailable();
  return {
    weddingId: String(row.weddingId),
    accessId: String(row._id),
    purpose,
    generation: row.token.version,
  };
}
export async function setGalleryCookie(response: NextResponse, grant: Grant) {
  const name = cookieName(grant.weddingId, grant.purpose),
    maxAge = 15 * 60;
  response.cookies.set(
    name,
    await encode({ token: grant, secret: authSecret(), salt: name, maxAge }),
    {
      httpOnly: true,
      secure: appOrigin().startsWith("https:"),
      sameSite: "lax",
      path: "/",
      maxAge,
    },
  );
}
export async function galleryAccess(
  actor: AccountActor,
  w: string,
  purpose?: Purpose,
) {
  await authorize({ member: actor }, w, "view");
  const rows = await GalleryAccess.find({ weddingId: w }).select("+token");
  if (purpose) {
    const row = rows.find(
      (r) => r.purpose === purpose && r.status === "active",
    );
    if (!row) throw unavailable();
    const token = recoverToken(
      row.token,
      `gallery:${w}:${purpose}:${row._id}:${row.token.version}`,
    );
    return {
      url: `${appOrigin()}/gallery/${purpose}/access#token=${encodeURIComponent(token)}`,
      purpose,
    };
  }
  return Object.fromEntries(
    rows.map((r) => [
      r.purpose,
      { id: String(r._id), status: r.status, version: r.version },
    ]),
  );
}
