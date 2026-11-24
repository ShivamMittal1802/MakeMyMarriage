import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { api, readJson, success } from "@/lib/http/api";
import { AppError } from "@/lib/http/errors";
import { currentActor } from "@/lib/access/actor";
import { assertCsrf } from "@/lib/security/csrf";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  memberListSchema,
  invitationListSchema,
  memberRolePatchSchema,
} from "./schemas";
import { invalidCursor } from "./pagination";
import {
  listMembers,
  getMember,
  listMemberInvitations,
  changeMemberRole,
  removeMember,
  revokeMemberInvitation,
} from "./team-service";

function query<T>(request: NextRequest, schema: z.ZodType<T>): T {
  const values: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (key in values)
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Query parameters must not be repeated.",
      );
    values[key] = value;
  }
  if (
    "cursor" in values &&
    (!values.cursor.length || values.cursor.length > 2048)
  )
    throw invalidCursor();
  const parsed = schema.safeParse(values);
  if (!parsed.success)
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "Check the list or version parameters.",
    );
  return parsed.data;
}
const versionQuery = z.strictObject({
  expectedVersion: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
});
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
