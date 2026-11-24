import "server-only";
import mongoose, { Types } from "mongoose";
import { auth } from "@/auth";
import { accountConfigured } from "@/lib/config/server";
import { ensureIdentityDatabase } from "@/lib/db/readiness";
import { AppError } from "@/lib/http/errors";
import { User } from "@/modules/identity/models";

export async function currentAccount() {
  if (!accountConfigured()) return null;
  const session = await auth();
  if (!session?.user?.id || !Types.ObjectId.isValid(session.user.id))
    return null;
  await ensureIdentityDatabase();
  return User.findOne({ _id: session.user.id, status: "active" }).lean();
}

export async function currentUserDto() {
  const user = await currentAccount();
  if (!user)
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Log in to continue.");
  // Read-only integration with the membership contract; creation/administration comes next.
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
    emailVerified: !!user.emailVerifiedAt,
    membership: currentMembership,
  };
}
