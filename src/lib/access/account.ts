import "server-only";
import mongoose, { Types } from "mongoose";
import { auth } from "@/auth";
import { getToken } from "next-auth/jwt";
import { headers } from "next/headers";
import { accountConfigured, appOrigin, authSecret } from "@/lib/config/server";
import { AppError } from "@/lib/http/errors";
import { currentSessionUser } from "@/modules/identity/service";
import { emailVerificationSatisfied } from "./email-verification";

export async function currentAccount() {
  if (!accountConfigured()) return null;
  const session = await auth();
  if (!session?.user?.id || !Types.ObjectId.isValid(session.user.id))
    return null;
  // Keep the authenticated generation from the JWT. A password reset between
  // auth() and this database read must not upgrade an old session to a new one.
  const secureCookie = appOrigin().startsWith("https:");
  const cookieName = secureCookie
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
  const token = await getToken({
    req: { headers: new Headers(await headers()) },
    secret: authSecret(),
    secureCookie,
    cookieName,
    salt: cookieName,
  });
  if (!token || token.sub !== session.user.id) return null;
  return currentSessionUser(token.sub, token.sessionVersion);
}

export async function currentUserDto() {
  const user = await currentAccount();
  if (!user)
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Log in to continue.");
  // Return the current membership without requiring wedding-service configuration
  // for identity-only accounts. Wedding writes enforce their migration separately.
  const db = mongoose.connection.db!;
  const membership = await db
    .collection<{
      _id: Types.ObjectId;
      weddingId: Types.ObjectId;
      userId: Types.ObjectId;
      role: "bride" | "groom" | "manager";
      status: string;
      version: number;
    }>("memberships")
    .findOne({ userId: user._id, status: "active" });
  let currentMembership = null;
  if (membership) {
    const wedding = await db
      .collection<{ _id: Types.ObjectId; ownerUserId: Types.ObjectId }>(
        "weddings",
      )
      .findOne(
        { _id: membership.weddingId },
        { projection: { ownerUserId: 1 } },
      );
    if (wedding)
      currentMembership = {
        id: membership._id.toString(),
        weddingId: membership.weddingId.toString(),
        role: membership.role,
        isOwner: wedding.ownerUserId.equals(user._id),
        version: membership.version,
      };
  }
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.emailNormalized,
    emailVerified: emailVerificationSatisfied(user),
    membership: currentMembership,
  };
}
