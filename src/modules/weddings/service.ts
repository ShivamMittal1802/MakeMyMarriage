import "server-only";
import { Types, type ClientSession, type HydratedDocument } from "mongoose";
import { appOrigin, encryptionConfig } from "@/lib/config/server";
import { duplicateKey, transaction } from "@/lib/db/connection";
import { ensureWeddingDatabase } from "@/lib/db/wedding-readiness";
import { AppError } from "@/lib/http/errors";
import { emailVerificationSatisfied } from "@/lib/access/email-verification";
import {
  issueRecoverableToken,
  recoverToken,
} from "@/lib/security/token-envelope";
import { tokenHash } from "@/lib/security/crypto";
import { User } from "@/modules/identity/models";
import { GalleryAccess } from "@/modules/gallery/access-model";
import {
  Wedding,
  Membership,
  MemberInvitation,
  type WeddingRecord,
  type MemberInvitationRecord,
} from "./models";
import {
  objectIdSchema,
  weddingCreateSchema,
  memberInviteSchema,
  type WeddingCreate,
  type WeddingDto,
  type InviteDto,
  type MemberRole,
  type InviteContext,
} from "./schemas";

export type AccountActor = { id: string; sessionVersion: number };
export type InvitationGrant = {
  invitationId: string;
  weddingId: string;
  tokenVersion: number;
};
export function id(value: string) {
  if (!objectIdSchema.safeParse(value).success)
    throw new AppError(400, "INVALID_ID", "This address is invalid.");
  return new Types.ObjectId(value);
}
export function unavailableInvitation() {
  return new AppError(
    404,
    "LINK_UNAVAILABLE",
    "This invitation is invalid, expired, or no longer available. Ask the organiser for a new link.",
  );
}
function alreadyMember() {
  return new AppError(
    409,
    "ACTIVE_MEMBERSHIP_EXISTS",
    "You already belong to a wedding. Open your existing wedding to continue.",
  );
}
function roleTaken() {
  return new AppError(
    409,
    "ROLE_TAKEN",
    "This wedding’s bride or groom role has already been filled. Ask the organiser for a new invitation.",
  );
}

export async function accountInTransaction(
  actor: AccountActor,
  session?: ClientSession,
  write = false,
) {
  const filter = {
    _id: id(actor.id),
    status: "active" as const,
    sessionVersion: actor.sessionVersion,
  };
  const user = await User.findOne(filter).session(session ?? null);
  if (!user)
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Log in to continue.");
  if (!emailVerificationSatisfied(user))
    throw new AppError(
      403,
      "EMAIL_VERIFICATION_REQUIRED",
      "Verify your email before creating or joining a wedding.",
    );
  if (write) {
    const result = await User.updateOne(
      { ...filter, version: user.version },
      { $inc: { version: 1 } },
      { session },
    );
    if (!result.modifiedCount)
      throw new AppError(
        409,
        "ACCOUNT_CHANGED",
        "Your account changed. Refresh and try again.",
      );
  }
  return user;
}

function weddingDto(wedding: HydratedDocument<WeddingRecord>): WeddingDto {
  return {
    id: String(wedding._id),
    ownerUserId: String(wedding.ownerUserId),
    slug: wedding.slug,
    couple: {
      brideName: wedding.couple!.brideName,
      groomName: wedding.couple!.groomName,
    },
    weddingDate: wedding.weddingDate,
    location: wedding.location,
    introduction: wedding.introduction ?? undefined,
    timezone: "Asia/Kolkata",
    currency: "INR",
    publicUrl: `${appOrigin()}/weddings/${wedding.slug}`,
    version: wedding.version,
    createdAt: wedding.createdAt.toISOString(),
    updatedAt: wedding.updatedAt.toISOString(),
  };
}
function inviteDto(
  invite: HydratedDocument<MemberInvitationRecord>,
): InviteDto {
  return {
    id: String(invite._id),
    weddingId: String(invite.weddingId),
    email: invite.emailNormalized,
    role: invite.role as MemberRole,
    status: invite.status as InviteDto["status"],
    expiresAt: invite.expiresAt.toISOString(),
    acceptedAt: invite.acceptedAt?.toISOString(),
    version: invite.version,
    createdAt: invite.createdAt.toISOString(),
    updatedAt: invite.updatedAt.toISOString(),
  };
}

export async function activeMembership(actor: AccountActor) {
  await ensureWeddingDatabase();
  await accountInTransaction(actor);
  return Membership.findOne({ userId: id(actor.id), status: "active" });
}
export async function weddingForMember(
  actor: AccountActor,
  weddingId: string,
  session?: ClientSession,
  admin = false,
  write = false,
) {
  await accountInTransaction(actor, session, write);
  const wedding = await Wedding.findById(id(weddingId)).session(
    session ?? null,
  );
  const membership = await Membership.findOne({
    weddingId: id(weddingId),
    userId: id(actor.id),
    status: "active",
  }).session(session ?? null);
  if (!wedding || !membership)
    throw new AppError(404, "NOT_FOUND", "This wedding is not available.");
  const isOwner = wedding.ownerUserId.equals(id(actor.id));
  if (admin && !isOwner && !["bride", "groom"].includes(membership.role))
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the owner, bride, or groom can invite the planning team.",
    );
  if (write) {
    const fenced = await Membership.updateOne(
      { _id: membership._id, status: "active", version: membership.version },
      { $inc: { version: 1 } },
      { session },
    );
    if (!fenced.modifiedCount)
      throw new AppError(
        409,
        "MEMBERSHIP_CHANGED",
        "Your wedding access changed. Refresh and try again.",
      );
  }
  return { wedding, membership, isOwner };
}
export async function getWedding(actor: AccountActor, weddingId: string) {
  await ensureWeddingDatabase();
  return weddingDto((await weddingForMember(actor, weddingId)).wedding);
}

export async function createWedding(actor: AccountActor, input: WeddingCreate) {
  const values = weddingCreateSchema.parse(input);
  await ensureWeddingDatabase();
  encryptionConfig();
  try {
    return await transaction(async (session) => {
      await accountInTransaction(actor, session, true);
      if (
        await Membership.exists({
          userId: id(actor.id),
          status: "active",
        }).session(session)
      )
        throw alreadyMember();
      const weddingId = new Types.ObjectId();
      const [wedding] = await Wedding.create(
        [
          {
            _id: weddingId,
            ownerUserId: id(actor.id),
            couple: values.couple,
            weddingDate: values.weddingDate,
            location: values.location,
            slug: values.slug,
            ...(values.introduction
              ? { introduction: values.introduction }
              : {}),
          },
        ],
        { session },
      );
      await Membership.create(
        [{ weddingId, userId: id(actor.id), role: values.creatorRole }],
        { session },
      );
      for (const purpose of ["upload", "view"] as const) {
        const accessId = new Types.ObjectId();
        await GalleryAccess.create(
          [
            {
              _id: accessId,
              weddingId,
              purpose,
              token: issueRecoverableToken(
                `gallery:${weddingId}:${purpose}:${accessId}:0`,
              ),
            },
          ],
          { session },
        );
      }
      return weddingDto(wedding);
    });
  } catch (error) {
    if (duplicateKey(error)) {
      if (
        typeof error === "object" &&
        error &&
        "keyPattern" in error &&
        (error.keyPattern as Record<string, unknown>)?.slug
      )
        throw new AppError(
          409,
          "SLUG_TAKEN",
          "This website address is already taken. Choose another address.",
          {
            fields: [
              { path: "slug", message: "This address is already taken." },
            ],
          },
        );
      throw alreadyMember();
    }
    throw error;
  }
}

export async function createMemberInvitation(
  actor: AccountActor,
  weddingId: string,
  input: { email: string; role: MemberRole },
) {
  const values = memberInviteSchema.parse(input);
  await ensureWeddingDatabase();
  encryptionConfig();
  try {
    return await transaction(async (session) => {
      const { wedding } = await weddingForMember(
        actor,
        weddingId,
        session,
        true,
        true,
      );
      const now = new Date();
      await MemberInvitation.updateMany(
        {
          weddingId: wedding._id,
          emailNormalized: values.email,
          status: "pending",
          expiresAt: { $lte: now },
        },
        { $set: { status: "expired" }, $inc: { version: 1 } },
        { session },
      );
      if (
        await MemberInvitation.exists({
          weddingId: wedding._id,
          emailNormalized: values.email,
          status: "pending",
        }).session(session)
      )
        throw new AppError(
          409,
          "INVITATION_EXISTS",
          "A pending invitation already exists for this email.",
        );
      const invitationId = new Types.ObjectId();
      const [invite] = await MemberInvitation.create(
        [
          {
            _id: invitationId,
            weddingId: wedding._id,
            invitedBy: id(actor.id),
            emailNormalized: values.email,
            role: values.role,
            expiresAt: new Date(now.getTime() + 7 * 86_400_000),
            token: issueRecoverableToken(
              `member-invitation:${wedding._id}:${invitationId}:0`,
            ),
          },
        ],
        { session },
      );
      return inviteDto(invite);
    });
  } catch (error) {
    if (duplicateKey(error))
      throw new AppError(
        409,
        "INVITATION_EXISTS",
        "A pending invitation already exists for this email.",
      );
    throw error;
  }
}
export async function recentMemberInvitations(
  actor: AccountActor,
  weddingId: string,
) {
  await ensureWeddingDatabase();
  await weddingForMember(actor, weddingId, undefined, true);
  return (
    await MemberInvitation.find({ weddingId: id(weddingId), status: "pending" })
      .sort({ createdAt: -1, _id: -1 })
      .limit(25)
  ).map(inviteDto);
}
export async function getMemberInvitation(
  actor: AccountActor,
  weddingId: string,
  invitationId: string,
) {
  await ensureWeddingDatabase();
  await weddingForMember(actor, weddingId, undefined, true);
  const invite = await MemberInvitation.findOne({
    _id: id(invitationId),
    weddingId: id(weddingId),
  });
  if (!invite)
    throw new AppError(404, "NOT_FOUND", "This invitation is not available.");
  return inviteDto(invite);
}
export async function shareMemberInvitation(
  actor: AccountActor,
  weddingId: string,
  invitationId: string,
) {
  await ensureWeddingDatabase();
  return transaction(async (session) => {
    await weddingForMember(actor, weddingId, session, true, true);
    const invite = await MemberInvitation.findOne({
      _id: id(invitationId),
      weddingId: id(weddingId),
      status: "pending",
      expiresAt: { $gt: new Date() },
    })
      .session(session)
      .select("+token");
    if (!invite) throw unavailableInvitation();
    const raw = recoverToken(
      invite.token!,
      `member-invitation:${invite.weddingId}:${invite._id}:${invite.token!.version}`,
    );
    return {
      url: `${appOrigin()}/join#token=${raw}`,
      expiresAt: invite.expiresAt.toISOString(),
    };
  });
}
export async function exchangeMemberInvitation(token: string) {
  await ensureWeddingDatabase();
  const invite = await MemberInvitation.findOne({
    "token.hash": tokenHash(token),
    status: "pending",
    expiresAt: { $gt: new Date() },
  }).select("+token");
  if (!invite) throw unavailableInvitation();
  const wedding = await Wedding.findById(invite.weddingId);
  if (!wedding) throw unavailableInvitation();
  const context: InviteContext = {
    invitationId: String(invite._id),
    couple: {
      brideName: wedding.couple!.brideName,
      groomName: wedding.couple!.groomName,
    },
    role: invite.role as MemberRole,
    expiresAt: invite.expiresAt.toISOString(),
    cleanPath: `/join/${invite._id}`,
  };
  return {
    context,
    grant: {
      invitationId: String(invite._id),
      weddingId: String(invite.weddingId),
      tokenVersion: invite.token!.version,
    },
  };
}
export async function invitationContext(
  grant: InvitationGrant,
  actor?: AccountActor,
) {
  await ensureWeddingDatabase();
  const invite = await MemberInvitation.findOne({
    _id: id(grant.invitationId),
    weddingId: id(grant.weddingId),
    "token.version": grant.tokenVersion,
    expiresAt: { $gt: new Date() },
  }).select("+token");
  if (!invite || !["pending", "accepted"].includes(invite.status))
    throw unavailableInvitation();
  const wedding = await Wedding.findById(invite.weddingId);
  if (!wedding) throw unavailableInvitation();
  if (
    invite.status === "accepted" &&
    (!actor ||
      !invite.acceptedBy?.equals(id(actor.id)) ||
      !(await Membership.exists({
        userId: id(actor.id),
        weddingId: invite.weddingId,
        status: "active",
      })))
  )
    throw unavailableInvitation();
  return {
    context: {
      invitationId: String(invite._id),
      couple: {
        brideName: wedding.couple!.brideName,
        groomName: wedding.couple!.groomName,
      },
      role: invite.role as MemberRole,
      expiresAt: invite.expiresAt.toISOString(),
      cleanPath: `/join/${invite._id}`,
    },
    matchesEmail: actor
      ? (
          await User.findOne({
            _id: id(actor.id),
            status: "active",
            sessionVersion: actor.sessionVersion,
          })
        )?.emailNormalized === invite.emailNormalized
      : false,
    accepted: invite.status === "accepted",
  };
}
export async function acceptMemberInvitation(
  actor: AccountActor,
  grant: InvitationGrant,
) {
  await ensureWeddingDatabase();
  try {
    return await transaction(async (session) => {
      const user = await accountInTransaction(actor, session, true);
      const invite = await MemberInvitation.findOne({
        _id: id(grant.invitationId),
        weddingId: id(grant.weddingId),
        "token.version": grant.tokenVersion,
        expiresAt: { $gt: new Date() },
      })
        .session(session)
        .select("+token");
      if (!invite || !["pending", "accepted"].includes(invite.status))
        throw unavailableInvitation();
      if (user.emailNormalized !== invite.emailNormalized)
        throw new AppError(
          403,
          "INVITATION_EMAIL_MISMATCH",
          "Sign in with the email address that received this invitation.",
        );
      if (invite.status === "accepted") {
        const existing = invite.acceptedBy?.equals(user._id)
          ? await Membership.findOne({
              userId: user._id,
              weddingId: invite.weddingId,
              status: "active",
            }).session(session)
          : null;
        if (!existing) throw unavailableInvitation();
        return {
          id: String(existing._id),
          userId: String(user._id),
          name: user.name,
          role: existing.role,
          isOwner: false,
          status: existing.status,
          joinedAt: existing.joinedAt.toISOString(),
          version: existing.version,
        };
      }
      if (
        await Membership.exists({ userId: user._id, status: "active" }).session(
          session,
        )
      )
        throw alreadyMember();
      const wedding = await Wedding.findOneAndUpdate(
        { _id: invite.weddingId },
        { $inc: { version: 1 } },
        { session },
      );
      if (!wedding) throw unavailableInvitation();
      if (
        invite.role !== "manager" &&
        (await Membership.exists({
          weddingId: invite.weddingId,
          status: "active",
          role: invite.role,
        }).session(session))
      )
        throw roleTaken();
      const changed = await MemberInvitation.updateOne(
        { _id: invite._id, status: "pending", version: invite.version },
        {
          $set: {
            status: "accepted",
            acceptedAt: new Date(),
            acceptedBy: user._id,
          },
          $inc: { version: 1 },
        },
        { session },
      );
      if (!changed.modifiedCount) throw unavailableInvitation();
      const [member] = await Membership.create(
        [
          {
            weddingId: invite.weddingId,
            userId: user._id,
            role: invite.role,
            invitedBy: invite.invitedBy,
          },
        ],
        { session },
      );
      return {
        id: String(member._id),
        userId: String(user._id),
        name: user.name,
        role: member.role,
        isOwner: false,
        status: member.status,
        joinedAt: member.joinedAt.toISOString(),
        version: member.version,
      };
    });
  } catch (error) {
    if (duplicateKey(error)) {
      if (await Membership.exists({ userId: id(actor.id), status: "active" }))
        throw alreadyMember();
      throw roleTaken();
    }
    throw error;
  }
}
