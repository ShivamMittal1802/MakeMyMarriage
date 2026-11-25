import type { NextRequest } from "next/server";
import {z} from "zod";
import {api,readJson,success} from "@/lib/http/api";
import {assertCsrf} from "@/lib/security/csrf";
import {consumeRateLimit} from "@/lib/security/rate-limit";
import {expectedVersionSchema} from "@/modules/weddings/schemas";
import {invitationView,readGrant} from "@/modules/rsvp/service";
type Context={params:Promise<{invitationId:string}>};
export const GET=(request:NextRequest,ctx:Context)=>api(async()=>success(await invitationView(await readGrant(request,(await ctx.params).invitationId))));
export const PATCH=(request:NextRequest,ctx:Context)=>api(async()=>{
assertCsrf(request);
const grant=await readGrant(request,(await ctx.params).invitationId);
await consumeRateLimit("rsvp-response",grant.invitationId,60,900000);
const change=await readJson(request,z.strictObject({expectedVersion:expectedVersionSchema,response:z.enum(["attending","declined"])}));
const {invitationId,response,version,respondedAt}=await invitationView(grant,change);
return success({invitationId,response,version,respondedAt});
});
