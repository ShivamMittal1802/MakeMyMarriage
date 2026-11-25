import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { api, readJson, success } from "@/lib/http/api";
import { currentActor } from "@/lib/access/actor";
import { assertCsrf } from "@/lib/security/csrf";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  memberListSchema,
  invitationListSchema,
  memberRolePatchSchema,
} from "./schemas";
import { query, versionQuery } from "@/lib/http/query";
import {
  listMembers,
  getMember,
  listMemberInvitations,
  changeMemberRole,
  removeMember,
  revokeMemberInvitation,
} from "./team-service";

export const listMembersHandler = (request: NextRequest, weddingId: string) =>
  api(async () => {
    return NextResponse.json(
      await listMembers(
        await currentActor(),
        weddingId,
        query(request, memberListSchema),
      ),
    );
  });
export const memberHandler = (weddingId: string, membershipId: string) =>
  api(async () =>
    success(await getMember(await currentActor(), weddingId, membershipId)),
  );
export const listInvitationsHandler = (
  request: NextRequest,
  weddingId: string,
) =>
  api(async () => {
    return NextResponse.json(
      await listMemberInvitations(
        await currentActor(),
        weddingId,
        query(request, invitationListSchema),
      ),
    );
  });
export const patchMemberHandler = (
  request: NextRequest,
  weddingId: string,
  membershipId: string,
) =>
  api(async () => {
    assertCsrf(request);
    const actor = await currentActor();
    await consumeRateLimit("member-role-change", actor.id, 60, 15 * 60_000);
    return success(
      await changeMemberRole(
        actor,
        weddingId,
        membershipId,
        await readJson(request, memberRolePatchSchema),
      ),
    );
  });
export const removeMemberHandler = (
  request: NextRequest,
  weddingId: string,
  membershipId: string,
) =>
  api(async () => {
    assertCsrf(request);
    const actor = await currentActor();
    await consumeRateLimit("member-remove", actor.id, 30, 15 * 60_000);
    await removeMember(
      actor,
      weddingId,
      membershipId,
      query(request, versionQuery).expectedVersion,
    );
    return new NextResponse(null, { status: 204 });
  });
export const revokeInvitationHandler = (
  request: NextRequest,
  weddingId: string,
  invitationId: string,
) =>
  api(async () => {
    assertCsrf(request);
    const actor = await currentActor();
    await consumeRateLimit(
      "member-invitation-revoke",
      actor.id,
      60,
      15 * 60_000,
    );
    await revokeMemberInvitation(
      actor,
      weddingId,
      invitationId,
      query(request, versionQuery).expectedVersion,
    );
    return new NextResponse(null, { status: 204 });
  });
