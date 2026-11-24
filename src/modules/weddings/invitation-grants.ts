import "server-only";
import { encode, decode } from "next-auth/jwt";
import type { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { appOrigin, authSecret } from "@/lib/config/server";
import { objectIdSchema } from "./schemas";
import { unavailableInvitation, type InvitationGrant } from "./service";

const grantSchema = z.object({
  invitationId: objectIdSchema,
  weddingId: objectIdSchema,
  tokenVersion: z.number().int().nonnegative(),
  purpose: z.literal("member-invitation"),
  exp: z.number(),
});
function prefix() {
  return appOrigin().startsWith("https:") ? "__Host-mmm.join." : "mmm.join.";
}
export function pendingInvitationCookie() {
  return `${prefix()}pending`;
}
export function invitationCookie(invitationId: string) {
  return `${prefix()}${invitationId}`;
}
export async function setInvitationGrant(
  response: NextResponse,
  request: NextRequest,
  grant: InvitationGrant,
  expiresAt: string,
) {
  const name = invitationCookie(grant.invitationId);
  const maxAge = Math.min(
    15 * 60,
    Math.floor((Date.parse(expiresAt) - Date.now()) / 1000),
  );
  if (maxAge <= 0) throw unavailableInvitation();
  const encoded = await encode({
    token: { ...grant, purpose: "member-invitation" },
    secret: authSecret(),
    salt: name,
    maxAge,
  });
  const options = {
    httpOnly: true,
    secure: appOrigin().startsWith("https:"),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
  const old = request.cookies
    .getAll()
    .filter(
      (cookie) =>
        cookie.name.startsWith(prefix()) &&
        cookie.name !== pendingInvitationCookie() &&
        cookie.name !== name,
    );
  for (const cookie of old.slice(0, Math.max(0, old.length - 7)))
    response.cookies.set(cookie.name, "", { ...options, maxAge: 0 });
  response.cookies.set(name, encoded, options);
  response.cookies.set(pendingInvitationCookie(), grant.invitationId, options);
}
export async function readInvitationGrant(
  invitationId: string,
  request?: NextRequest,
): Promise<InvitationGrant> {
  if (!objectIdSchema.safeParse(invitationId).success)
    throw unavailableInvitation();
  const name = invitationCookie(invitationId);
  const value = request
    ? request.cookies.get(name)?.value
    : (await cookies()).get(name)?.value;
  if (!value) throw unavailableInvitation();
  try {
    const parsed = grantSchema.parse(
      await decode({ token: value, secret: authSecret(), salt: name }),
    );
    if (parsed.invitationId !== invitationId || parsed.exp <= Date.now() / 1000)
      throw unavailableInvitation();
    return {
      invitationId: parsed.invitationId,
      weddingId: parsed.weddingId,
      tokenVersion: parsed.tokenVersion,
    };
  } catch {
    throw unavailableInvitation();
  }
}
export async function pendingInvitationId() {
  const invitationId = (await cookies()).get(pendingInvitationCookie())?.value;
  if (!invitationId) return null;
  try {
    await readInvitationGrant(invitationId);
    return invitationId;
  } catch {
    return null;
  }
}
export function clearPendingInvitation(response: NextResponse) {
  response.cookies.set(pendingInvitationCookie(), "", {
    httpOnly: true,
    secure: appOrigin().startsWith("https:"),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
