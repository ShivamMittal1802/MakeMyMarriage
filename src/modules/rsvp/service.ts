import "server-only";
import { encode, decode } from "next-auth/jwt";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { transaction } from "@/lib/db/connection";
import { appOrigin, authSecret } from "@/lib/config/server";
import { tokenHash } from "@/lib/security/crypto";
import { AppError } from "@/lib/http/errors";
import { Guest, Invitation, ensureGuests } from "@/modules/guests/model";
import { WeddingEvent } from "@/modules/events/model";
import { Wedding } from "@/modules/weddings/models";
import { objectIdSchema } from "@/modules/weddings/schemas";
import { unavailableInvitation } from "@/modules/weddings/service";

const schema=z.object({invitationId:objectIdSchema,revision:z.number().int(),generation:z.number().int(),purpose:z.literal("rsvp")});
type Grant=z.infer<typeof schema>;
const prefix=()=>appOrigin().startsWith("https:")?"__Host-mmm.rsvp.":"mmm.rsvp.";
export async function exchange(token:string) {
  await ensureGuests();
  const row=await Invitation.findOne({"token.hash":tokenHash(token),status:"active"}).lean();
  if(!row) throw unavailableInvitation();
  const grant:Grant={invitationId:String(row._id),revision:row.guestContactRevision,generation:row.token.version,purpose:"rsvp"};
  await invitationView(grant);
  return grant;
}
export async function grantCookie(request:NextRequest,response:NextResponse,grant:Grant){
  const name=prefix()+grant.invitationId, maxAge=15*60;
  const options={path:"/",httpOnly:true,secure:appOrigin().startsWith("https:"),sameSite:"lax" as const,maxAge};
  const others=request.cookies.getAll().filter(c=>c.name.startsWith(prefix())&&c.name!==name);
  for(const old of others.slice(0,Math.max(0,others.length-7))) response.cookies.set(old.name,"",{...options,maxAge:0});
  response.cookies.set(name,await encode({token:grant,secret:authSecret(),salt:name,maxAge}),options);
}
export async function readGrant(request:NextRequest,invitationId:string){
  const name=prefix()+invitationId;
  const value=request.cookies.get(name)?.value;
  if(value && objectIdSchema.safeParse(invitationId).success){
    const decoded=await decode({token:value,secret:authSecret(),salt:name}).catch(()=>null);
    const parsed=schema.safeParse(decoded);
    if(parsed.success && parsed.data.invitationId===invitationId && typeof decoded?.exp==="number" && decoded.exp>Date.now()/1000) return parsed.data;
  }
  throw new AppError(401,"ACCESS_GRANT_REQUIRED","Reopen your original invitation link to view this event.");
}
export async function invitationView(grant:Grant,change?:{expectedVersion:number;response:"attending"|"declined"}){
  await ensureGuests();
  return transaction(async session=>{
    const filter={_id:grant.invitationId,status:"active" as const,guestContactRevision:grant.revision,"token.version":grant.generation};
    const row=await Invitation.findOne(filter).session(session);
    if(!row) throw unavailableInvitation();
    const person=await Guest.findOne({_id:row.guestId,weddingId:row.weddingId,isDeleted:false,contactRevision:grant.revision}).session(session);
    const event=await WeddingEvent.findOne({_id:row.eventId,weddingId:row.weddingId,isDeleted:false}).session(session);
    const wedding=await Wedding.findById(row.weddingId).session(session);
    if(!person || !event || !wedding) throw unavailableInvitation();
    if(change){
      if(row.version!==change.expectedVersion) throw new AppError(409,"VERSION_CONFLICT","Your response changed. Review it before saving again.",{currentVersion:row.version});
      if(row.rsvp!==change.response){
        row.rsvp=change.response;row.respondedAt=new Date();row.increment();await row.save({session});
      }
    }
    return {invitationId:grant.invitationId,guestName:person.name,couple:wedding.couple,event:{name:event.name,startsAt:event.startsAt.toISOString(),endsAt:event.endsAt?.toISOString(),location:event.location,description:event.description},response:row.rsvp,respondedAt:row.respondedAt?.toISOString(),version:row.version,publicWeddingUrl:"/weddings/"+wedding.slug};
  });
}
export type GuestInvitationView=Awaited<ReturnType<typeof invitationView>>;
