import type {NextRequest} from "next/server";
import {api,readJson,success} from "@/lib/http/api";
import {assertCsrf} from "@/lib/security/csrf";
import {consumeRateLimit,requestNetworkKey} from "@/lib/security/rate-limit";
import {invitationExchangeSchema} from "@/modules/weddings/schemas";
import {exchange,grantCookie} from "@/modules/rsvp/service";
export const POST=(request:NextRequest)=>api(async()=>{
 assertCsrf(request); await consumeRateLimit("rsvp-exchange", requestNetworkKey(request),60,900000);
 const {token}=await readJson(request,invitationExchangeSchema);
 const grant=await exchange(token);
 const response=success({invitationId:grant.invitationId,cleanPath:"/rsvp/"+grant.invitationId});
 await grantCookie(request,response,grant);return response;
});
