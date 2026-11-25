import "server-only";
import { Types, type ClientSession, type HydratedDocument } from "mongoose";
import { ensureWeddingDatabase } from "@/lib/db/wedding-readiness";
import { duplicateKey, transaction } from "@/lib/db/connection";
import { AppError } from "@/lib/http/errors";
import { User } from "@/modules/identity/models";
import { cancelInvitationJobs } from "@/modules/email/cancel-invitation-jobs";
import {
  Membership,
  MemberInvitation,
  Wedding,
  type MembershipRecord,
} from "./models";
import { id, inviteDto, weddingForMember, type AccountActor } from "./service";
import {
  memberListSchema,
  invitationListSchema,
  memberRolePatchSchema,
  expectedVersionSchema,
  type MemberDto,
  type InviteDto,
  type ListPage,
} from "./schemas";
import { readPosition, writePosition } from "./pagination";

function changed() {
  return new AppError(
    409,
    "VERSION_CONFLICT",
    "This record was updated by someone else. Refresh to review the latest details.",
  );
}
function missingMember() {
  return new AppError(404, "NOT_FOUND", "This member is no longer available.");
}
function protectedOwner() {
  return new AppError(
    409,
    "OWNER_PROTECTED",
    "Ownership and the owner’s role cannot be changed.",
  );
}
function isAdministrator(access: Awaited<ReturnType<typeof weddingForMember>>) {
  return access.isOwner || ["bride", "groom"].includes(access.membership.role);
}
function listScope(
  actor: AccountActor,
  weddingId: string,
  resource: string,
  status: string,
  limit: number,
  admin: boolean,
) {
  return JSON.stringify({
    actor: actor.id,
    generation: actor.sessionVersion,
    weddingId: String(id(weddingId)),
    resource,
    status,
    limit,
    admin,
  });
}
async function membersDto(
  records: HydratedDocument<MembershipRecord>[],
  ownerId: Types.ObjectId,
  admin: boolean,
) {
  const users = await User.find({
    _id: { $in: records.map((record) => record.userId) },
  })
    .select("name")
    .lean();
  const names = new Map(users.map((user) => [String(user._id), user.name]));
  return records.map((member): MemberDto => ({
    id: String(member._id),
    userId: String(member.userId),
    name: names.get(String(member.userId)) ?? "Wedding member",
    role: member.role as MemberDto["role"],
    isOwner: ownerId.equals(member.userId),
    status: member.status as MemberDto["status"],
    joinedAt: member.joinedAt.toISOString(),
    version: member.version,
    ...(admin && member.status === "revoked"
      ? {
          ...(member.revokedAt
            ? { revokedAt: member.revokedAt.toISOString() }
            : {}),
          ...(member.revokedBy ? { revokedBy: String(member.revokedBy) } : {}),
        }
      : {}),
  }));
}

export async function listMembers(
  actor: AccountActor,
  weddingId: string,
  input: unknown = {},
): Promise<ListPage<MemberDto>> {
  await ensureWeddingDatabase();
  const options = memberListSchema.parse(input);
  const access = await weddingForMember(actor, weddingId);
  const admin = isAdministrator(access);
  if (!admin && options.status === "revoked")
    throw new AppError(
      403,
      "FORBIDDEN",
      "Member history is available only to the owner, bride, or groom.",
    );
  const status = options.status;
  const scope = listScope(
    actor,
    weddingId,
    "members:joinedAt-asc",
    status ?? "all",
    options.limit,
    admin,
  );
  const position = readPosition(options.cursor, scope);
  const records = await Membership.find({
    weddingId: access.wedding._id,
    ...(status ? { status } : {}),
    ...(position
      ? {
          $or: [
            { joinedAt: { $gt: new Date(position.date) } },
            {
              joinedAt: new Date(position.date),
              _id: { $gt: id(position.id) },
            },
          ],
        }
      : {}),
  })
    .sort({ joinedAt: 1, _id: 1 })
    .limit(options.limit + 1);
  const hasMore = records.length > options.limit;
  const shown = records.slice(0, options.limit);
  const last = shown.at(-1);
  return {
    data: await membersDto(shown, access.wedding.ownerUserId, admin),
    page: {
      limit: options.limit,
      hasMore,
      nextCursor:
        hasMore && last
          ? writePosition(String(last._id), last.joinedAt, scope)
          : null,
    },
  };
}
export async function getMember(
  actor: AccountActor,
  weddingId: string,
  membershipId: string,
) {
  await ensureWeddingDatabase();
  const access = await weddingForMember(actor, weddingId);
  const admin = isAdministrator(access);
  const record = await Membership.findOne({
    _id: id(membershipId),
    weddingId: access.wedding._id,
    ...(!admin ? { status: "active" } : {}),
  });
  if (!record) throw missingMember();
  return (await membersDto([record], access.wedding.ownerUserId, admin))[0];
}
export async function listMemberInvitations(
  actor: AccountActor,
  weddingId: string,
  input: unknown = {},
): Promise<ListPage<InviteDto>> {
  await ensureWeddingDatabase();
  const options = invitationListSchema.parse(input);
  const access = await weddingForMember(actor, weddingId, undefined, true);
  const scope = listScope(
    actor,
    weddingId,
    "invitations:createdAt-desc",
    options.status,
    options.limit,
    true,
  );
  const position = readPosition(options.cursor, scope);
  const now = new Date();
  const stateFilter =
    options.status === "pending"
      ? { status: "pending" as const, expiresAt: { $gt: now } }
      : options.status === "expired"
        ? {
            $or: [
              { status: "expired" as const },
              { status: "pending" as const, expiresAt: { $lte: now } },
            ],
          }
        : { status: options.status };
  const records = await MemberInvitation.find({
    weddingId: access.wedding._id,
    $and: [
      stateFilter,
      ...(position
        ? [
            {
              $or: [
                { createdAt: { $lt: new Date(position.date) } },
                {
                  createdAt: new Date(position.date),
                  _id: { $lt: id(position.id) },
                },
              ],
            },
          ]
        : []),
    ],
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(options.limit + 1);
  const hasMore = records.length > options.limit;
  const shown = records.slice(0, options.limit);
  const last = shown.at(-1);
  return {
    data: shown.map(inviteDto),
    page: {
      limit: options.limit,
      hasMore,
      nextCursor:
        hasMore && last
          ? writePosition(String(last._id), last.createdAt, scope)
          : null,
    },
  };
}

async function targetForMutation(
  actor: AccountActor,
  weddingId: string,
  membershipId: string,
  expectedVersion: number,
  session: ClientSession,
  allowRevoked = false,
) {
  const access = await weddingForMember(actor, weddingId, session, true, true);
  const target = await Membership.findOne({
    _id: id(membershipId),
    weddingId: access.wedding._id,
  }).session(session);
  if (!target) throw missingMember();
  if (access.wedding.ownerUserId.equals(target.userId)) throw protectedOwner();
  // DELETE retries may refer to an older version of an already-revoked row.
  // Authorisation and wedding scope must still be checked before accepting it.
  if (allowRevoked && target.status === "revoked")
    return { access, target, version: target.version };
  // The actor fence already incremented this row if they are changing themselves.
  const version =
    expectedVersion + (target.userId.equals(id(actor.id)) ? 1 : 0);
  if (target.status !== "active" || target.version !== version) throw changed();
  await Wedding.updateOne(
    { _id: access.wedding._id },
    { $inc: { version: 1 } },
    { session },
  );
  return { access, target, version };
}
export async function changeMemberRole(
  actor: AccountActor,
  weddingId: string,
  membershipId: string,
  input: unknown,
) {
  const values = memberRolePatchSchema.parse(input);
  await ensureWeddingDatabase();
  try {
    await transaction(async (session) => {
      const { target, version } = await targetForMutation(
        actor,
        weddingId,
        membershipId,
        values.expectedVersion,
        session,
      );
      if (
        values.role !== "manager" &&
        (await Membership.exists({
          weddingId: target.weddingId,
          role: values.role,
          status: "active",
          _id: { $ne: target._id },
        }).session(session))
      )
        throw new AppError(
          409,
          "ROLE_OCCUPIED",
          "This role is already filled. Choose another role or refresh the team.",
        );
      const result = await Membership.updateOne(
        { _id: target._id, status: "active", version },
        { $set: { role: values.role }, $inc: { version: 1 } },
        { session },
      );
      if (result.modifiedCount !== 1) throw changed();
    });
  } catch (error) {
    if (duplicateKey(error))
      throw new AppError(
        409,
        "ROLE_OCCUPIED",
        "This role is already filled. Choose another role or refresh the team.",
      );
    throw error;
  }
  return getMember(actor, weddingId, membershipId);
}
export async function removeMember(
  actor: AccountActor,
  weddingId: string,
  membershipId: string,
  expectedVersion: number,
) {
  expectedVersionSchema.parse(expectedVersion);
  await ensureWeddingDatabase();
  await transaction(async (session) => {
    const { target, version } = await targetForMutation(
      actor,
      weddingId,
      membershipId,
      expectedVersion,
      session,
      true,
    );
    if (target.status === "revoked") return;
    const user = await User.findById(target.userId)
      .select("emailNormalized")
      .session(session);
    if (!user) throw changed();
    const now = new Date();
    const invitations = await MemberInvitation.find({
      weddingId: target.weddingId,
      emailNormalized: user.emailNormalized,
      status: "pending",
    })
      .select("_id")
      .session(session);
    await MemberInvitation.updateMany(
      { _id: { $in: invitations.map((item) => item._id) }, status: "pending" },
      {
        $set: { status: "revoked", revokedAt: now, revokedBy: id(actor.id) },
        $inc: { version: 1, "token.version": 1 },
      },
      { session },
    );
    await cancelInvitationJobs(
      target.weddingId,
      invitations.map((item) => item._id),
      session,
      now,
    );
    const result = await Membership.updateOne(
      { _id: target._id, status: "active", version },
      {
        $set: { status: "revoked", revokedAt: now, revokedBy: id(actor.id) },
        $inc: { version: 1 },
      },
      { session },
    );
    if (result.modifiedCount !== 1) throw changed();
  });
}
export async function revokeMemberInvitation(
  actor: AccountActor,
  weddingId: string,
  invitationId: string,
  expectedVersion: number,
) {
  expectedVersionSchema.parse(expectedVersion);
  await ensureWeddingDatabase();
  await transaction(async (session) => {
    await weddingForMember(actor, weddingId, session, true, true);
    const invitation = await MemberInvitation.findOne({
      _id: id(invitationId),
      weddingId: id(weddingId),
    }).session(session);
    if (!invitation)
      throw new AppError(
        404,
        "NOT_FOUND",
        "This invitation is no longer available.",
      );
    if (invitation.status === "revoked") return;
    await Wedding.updateOne(
      { _id: id(weddingId) },
      { $inc: { version: 1 } },
      { session },
    );
    if (invitation.status === "accepted")
      throw new AppError(
        409,
        "INVITATION_ACCEPTED",
        "This invitation has already been accepted. Review the Members tab.",
      );
    if (invitation.version !== expectedVersion) throw changed();
    if (invitation.status !== "pending" || invitation.expiresAt <= new Date())
      throw new AppError(
        409,
        "LINK_UNAVAILABLE",
        "This invitation is no longer pending. Refresh the list.",
      );
    const now = new Date();
    const result = await MemberInvitation.updateOne(
      { _id: invitation._id, version: expectedVersion, status: "pending" },
      {
        $set: { status: "revoked", revokedAt: now, revokedBy: id(actor.id) },
        $inc: { version: 1, "token.version": 1 },
      },
      { session },
    );
    if (result.modifiedCount !== 1) throw changed();
    await cancelInvitationJobs(
      invitation.weddingId,
      [invitation._id],
      session,
      now,
    );
  });
}
