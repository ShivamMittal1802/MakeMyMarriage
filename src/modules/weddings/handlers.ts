import "server-only";
import type { NextRequest } from "next/server";
import { api, readJson, success } from "@/lib/http/api";
import { assertCsrf } from "@/lib/security/csrf";
import { consumeRateLimit, requestNetworkKey } from "@/lib/security/rate-limit";
import { currentActor } from "@/lib/access/actor";
import {
  weddingCreateSchema,
  weddingPatchSchema,
  memberInviteSchema,
  invitationExchangeSchema,
  emptyBodySchema,
} from "./schemas";
import {
  createWedding,
  getWedding,
  updateWedding,
  createMemberInvitation,
  shareMemberInvitation,
  exchangeMemberInvitation,
  acceptMemberInvitation,
  getMemberInvitation,
} from "./service";
import {
  setInvitationGrant,
  readInvitationGrant,
  clearPendingInvitation,
} from "./invitation-grants";

export const createWeddingHandler = (request: NextRequest) =>
  api(async () => {
    assertCsrf(request);
    const actor = await currentActor();
    await consumeRateLimit("create-wedding", actor.id, 10, 15 * 60_000);
    const wedding = await createWedding(
      actor,
      await readJson(request, weddingCreateSchema),
    );
    const response = success(wedding, 201);
    response.headers.set("Location", `/api/v1/weddings/${wedding.id}`);
    return response;
  });
export const getWeddingHandler = (weddingId: string) =>
  api(async () => success(await getWedding(await currentActor(), weddingId)));
export const updateWeddingHandler = (request: NextRequest, weddingId: string) =>
  api(async () => {
    assertCsrf(request);
    const actor = await currentActor();
    await consumeRateLimit("edit-wedding", actor.id, 60, 15 * 60_000);
    return success(
      await updateWedding(
        actor,
        weddingId,
        await readJson(request, weddingPatchSchema),
      ),
    );
  });
export const createInviteHandler = (request: NextRequest, weddingId: string) =>
  api(async () => {
    assertCsrf(request);
    const actor = await currentActor();
    await consumeRateLimit(
      "member-invitation-create",
      actor.id,
      30,
      15 * 60_000,
    );
    const invite = await createMemberInvitation(
      actor,
      weddingId,
      await readJson(request, memberInviteSchema),
    );
    const response = success(invite, 201);
    response.headers.set(
      "Location",
      `/api/v1/weddings/${weddingId}/member-invitations/${invite.id}`,
    );
    return response;
  });
export const shareInviteHandler = (
  request: NextRequest,
  weddingId: string,
  invitationId: string,
) =>
  api(async () => {
    assertCsrf(request);
    await readJson(request, emptyBodySchema);
    const actor = await currentActor();
    await consumeRateLimit(
      "member-invitation-share",
      actor.id,
      60,
      15 * 60_000,
    );
    return success(await shareMemberInvitation(actor, weddingId, invitationId));
  });
export const exchangeInviteHandler = (request: NextRequest) =>
  api(async () => {
    assertCsrf(request);
    await consumeRateLimit(
      "member-invitation-exchange",
      requestNetworkKey(request),
      60,
      15 * 60_000,
    );
    const { token } = await readJson(request, invitationExchangeSchema);
    const { context, grant } = await exchangeMemberInvitation(token);
    const response = success(context);
    await setInvitationGrant(response, request, grant, context.expiresAt);
    return response;
  });
export const acceptInviteHandler = (
  request: NextRequest,
  invitationId: string,
) =>
  api(async () => {
    assertCsrf(request);
    await readJson(request, emptyBodySchema);
    const actor = await currentActor();
    await consumeRateLimit(
      "member-invitation-accept",
      actor.id,
      20,
      15 * 60_000,
    );
    const membership = await acceptMemberInvitation(
      actor,
      await readInvitationGrant(invitationId, request),
    );
    const response = success(membership);
    clearPendingInvitation(response);
    return response;
  });

export const getInviteHandler = (weddingId: string, invitationId: string) =>
  api(async () =>
    success(
      await getMemberInvitation(await currentActor(), weddingId, invitationId),
    ),
  );
