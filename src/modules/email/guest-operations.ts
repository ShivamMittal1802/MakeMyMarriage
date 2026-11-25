import "server-only";
import { Types,type ClientSession } from "mongoose";
import {z} from "zod";
import { AppError } from "@/lib/http/errors";
import { transaction,duplicateKey } from "@/lib/db/connection";
import { appOrigin,emailConfig } from "@/lib/config/server";
import { openPayload,sealPayload,tokenHash } from "@/lib/security/crypto";
import { recoverToken } from "@/lib/security/token-envelope";
import { WeddingEvent } from "@/modules/events/model";
import { Guest,Invitation,ensureGuests } from "@/modules/guests/model";
import { weddingForMember,id,type AccountActor } from "@/modules/weddings/service";
import { objectIdSchema } from "@/modules/weddings/schemas";
import { EmailOperation,EmailJob,jobStates,Usage } from "./models";
import { availableEmailQuota } from "./quota";
import { dispatchEmailJob,reconcileIdentityEmail } from "./identity-delivery";
import {dayLabel,timeLabel} from "@/modules/events/time";
import {readPosition,writePosition} from "@/modules/weddings/pagination";

const kinds=["guestInvitation","guestReminder"] as const;
const statuses=z.enum(["pending","attending","declined"]);
export const selectionSchema=z.strictObject({
 kind:z.enum(kinds),eventId:objectIdSchema,
 recipients:z.discriminatedUnion("type",[
 z.strictObject({type:z.literal("ids"),invitationIds:z.array(objectIdSchema).min(1).max(1000)}),
 z.strictObject({type:z.literal("filter"),rsvpStatuses:z.array(statuses).min(1).max(3)})])});
type Input=z.infer<typeof selectionSchema>;
type Snapshot={eventId:string;kind:Input["kind"];eventVersion:number;mode:string;expires:number;rows:[string,number,number][]};
const changed=()=>new AppError(409,"SELECTION_CHANGED","The guest list, event or delivery settings changed. Preview again.");
const missing=()=>new AppError(404,"NOT_FOUND","This wedding record is unavailable.");
const scope=(a:AccountActor,w:string)=>"guest-mail:"+w+":"+a.id+":"+a.sessionVersion;
const quota=(s:ClientSession)=>emailConfig().mode==="simulated"?Promise.resolve(null):availableEmailQuota(s,new Date());
async function selection(w:string,input:Input,s:ClientSession){
 const event=await WeddingEvent.findOne({_id:id(input.eventId),weddingId:id(w),isDeleted:false}).session(s);
 if(!event)throw missing();
 const recipients=input.recipients;
 const rows=await Invitation.find({weddingId:id(w),eventId:event._id,...(recipients.type==="ids"?{_id:{$in:recipients.invitationIds.map(id)}}:{status:"active",rsvp:{$in:recipients.rsvpStatuses}})}).sort({_id:1}).limit(1001).session(s);
 if(rows.length>1000)throw new AppError(422,"SELECTION_TOO_LARGE","Select at most 1,000 invitations per operation.");
 if(recipients.type==="ids"&& rows.length!==new Set(recipients.invitationIds).size) throw missing();
 const people=await Guest.find({_id:{$in:rows.map(r=>r.guestId)},weddingId:id(w),isDeleted:false}).session(s);
 const peopleById=new Map(people.map(p=>[String(p._id),p]));
 const excluded={inactive:0,missingEmail:0};
 const eligible=rows.flatMap(invitation=>{const guest=peopleById.get(String(invitation.guestId));
 if(invitation.status!=="active"||!guest||guest.contactRevision!==invitation.guestContactRevision){excluded.inactive++;return []}
 if(!guest.emailNormalized){excluded.missingEmail++;return []}
 return [{invitation,guest,email:guest.emailNormalized}];});
 const revisions:Snapshot["rows"]=eligible.map(({invitation:i})=>[String(i._id),i.guestContactRevision,i.token.version]);
 return {event,selectedCount:rows.length,eligible,excluded,revisions};
}
export async function preview(a:AccountActor,w:string,input:Input){
 await ensureGuests();
 return transaction(async s=>{await weddingForMember(a,w,s);
 const result=await selection(w,input,s),mode=emailConfig().mode,expires=Date.now()+600000;
 const snapshot:Snapshot={kind:input.kind,eventId:input.eventId,eventVersion:result.event.version,rows:result.revisions,mode,expires};
 return {kind:input.kind,eventId:input.eventId,selectedCount:result.selectedCount,eligibleCount:result.eligible.length,excluded:result.excluded,mode,availableToday:await quota(s),expiresAt:new Date(expires).toISOString(),selectionToken:result.eligible.length?Buffer.from(JSON.stringify(sealPayload(snapshot,scope(a,w)))).toString("base64url"):null};
 });
}
function escapeHtml(text:string){return text.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));}
export async function createOperation(a:AccountActor,w:string,token:string,key:string){
 if(!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw new AppError(422,"VALIDATION_ERROR","Supply an Idempotency-Key for this confirmation.");
 await ensureGuests();
 const scopeKey="wedding:"+w,requestHash=tokenHash(scope(a,w)+token);
 const create=()=>transaction(async s=>{
 await weddingForMember(a,w,s,false,true);
 const existing=await EmailOperation.findOne({scopeKey,requestKey:key}).session(s);
 if(existing){if(existing.requestHash!==requestHash)throw new AppError(409,"IDEMPOTENCY_CONFLICT","This confirmation key has already been used.");return String(existing._id)}
 let snap:Snapshot;
 try{snap=openPayload(JSON.parse(Buffer.from(token,"base64url").toString()),scope(a,w));}catch{throw changed()}
 const cfg=emailConfig();
 if(snap.expires<=Date.now()||cfg.mode!==snap.mode)throw changed();
 const found=await selection(w,{kind:snap.kind,eventId:snap.eventId,recipients:{type:"ids",invitationIds:snap.rows.map(r=>r[0])}},s).catch(e=>{if(e instanceof AppError&&e.status===404)throw changed();throw e});
 if(found.event.version!==snap.eventVersion||JSON.stringify(found.revisions)!==JSON.stringify(snap.rows))throw changed();
 // Serialize confirmation with concurrent edits and revocations without changing user-facing versions.
 await WeddingEvent.collection.updateOne({_id:found.event._id},{$inc:{emailFence:1}},{session:s});
 await Invitation.collection.updateMany({_id:{$in:found.eligible.map(r=>r.invitation._id)}},{$inc:{emailFence:1}},{session:s});
 const [op]=await EmailOperation.create([{scopeKey,weddingId:id(w),initiatedByUserId:id(a.id),eventId:found.event._id,kind:snap.kind,mode:cfg.mode,requestKey:key,requestHash,status:"open",expectedJobs:found.eligible.length}],{session:s});
 const jobs=found.eligible.map(({invitation:i,guest,email})=>{
 const jobId=new Types.ObjectId(),raw=recoverToken(i.token,`rsvp:${w}:${i._id}:${i.token.version}`);
 const link=appOrigin()+"/invitations#token="+raw;
 const actual=cfg.mode==="test"?cfg.testRecipient:email;
 const event=found.event;
 const note=`${guest.name}, you're invited to ${event.name}.\n${dayLabel(event.startsAt.toISOString())} · ${timeLabel(event.startsAt.toISOString())} IST\n${event.location}`;
 const payload={from:cfg.from,to:actual,templateVersion:1,subject:(cfg.mode==="test"?"[TEST] ":"")+(snap.kind==="guestReminder"?"RSVP reminder":"Wedding invitation")+" — "+event.name.replace(/[\r\n]/g," "),text:note+"\n\nRespond to your invitation: "+link,html:"<p>"+escapeHtml(note).replace(/\n/g,"<br>")+'</p><p><a href="'+escapeHtml(link)+'">Respond to your invitation</a></p>'};
 return {_id:jobId,operationId:op._id,weddingId:id(w),scopeKey,subjectType:"eventInvitation",subjectId:i._id,subjectKey:"eventInvitation:"+i._id,contactRevision:i.guestContactRevision,tokenVersion:i.token.version,intendedRecipient:email,actualRecipient:actual,mode:cfg.mode,kind:snap.kind,payloadCipher:sealPayload(payload,"email:"+jobId),payloadHash:tokenHash(JSON.stringify(payload)),idempotencyKey:`guest:${cfg.namespace}:${cfg.mode}:${jobId}`,state:"pending"};
 });
 await EmailJob.insertMany(jobs,{session:s});return String(op._id);
 });
 let op:string;try{op=await create()}catch(e){if(!duplicateKey(e))throw e;op=await create()}
 return operation(a,w,op);
}
async function scopedOp(a:AccountActor,w:string,o:string,s:ClientSession,write=false){
 await weddingForMember(a,w,s,false,write);
 const op=await EmailOperation.findOne({_id:id(o),weddingId:id(w),kind:{$in:kinds}}).session(s);
 if(!op)throw missing();return op;
}
async function summary(op:InstanceType<typeof EmailOperation>,s:ClientSession){
 const rows=await EmailJob.aggregate<{_id:string;n:number}>([{$match:{operationId:op._id}},{$group:{_id:"$state",n:{$sum:1}}}]).session(s);
 const counts=Object.fromEntries(jobStates.map(st=>[st,rows.find(r=>r._id===st)?.n??0]));
 const pendingCount=counts.pending+counts.deferredQuota+counts.retryableFailed;
 const ready=pendingCount?await EmailJob.countDocuments({operationId:op._id,state:{$in:["pending","retryableFailed","deferredQuota"]},cancelRequestedAt:{$exists:false},$or:[{retryNotBefore:{$exists:false}},{retryNotBefore:{$lte:new Date()}}]}).session(s):0;
 const available=ready?await quota(s):null;
 const status:InstanceType<typeof EmailOperation>["status"]=op.status==="cancelled"?"cancelled":pendingCount||counts.processing||counts.needsReview?"open":"closed";
 const eligibleNowCount=status==="cancelled"||op.mode!==emailConfig().mode?0:Math.min(ready,available??ready);
 return {id:String(op._id),weddingId:String(op.weddingId),eventId:String(op.eventId),kind:op.kind,mode:op.mode,status,expectedJobs:op.expectedJobs,counts,pendingCount,eligibleNowCount,continueAllowed:eligibleNowCount>0,blockedReason:ready&&available===0?"quota":undefined,version:op.version,createdAt:op.createdAt,updatedAt:op.updatedAt};
}
export async function operation(a:AccountActor,w:string,o:string){
 return transaction(async s=>summary(await scopedOp(a,w,o,s),s));
}
export async function continueOperation(a:AccountActor,w:string,o:string){
 await operation(a,w,o);await reconcileIdentityEmail(10,id(o));
 const ids=await transaction(async s=>{const op=await scopedOp(a,w,o,s,true);
 if(op.status==="cancelled")return [];
 return EmailJob.find({operationId:op._id,state:{$in:["pending","retryableFailed","deferredQuota"]},cancelRequestedAt:{$exists:false},$or:[{retryNotBefore:{$exists:false}},{retryNotBefore:{$lte:new Date()}}]}).sort({_id:1}).limit(10).select("_id").session(s).then(rows=>rows.map(row=>row._id));
 });
 let processed=0; const batch:Record<string,number>={claimed:0};let quotaBlocked=false;
 for(const jobId of ids){
 const outcome=await dispatchEmailJob(jobId,undefined,0,id(o));
 if(!outcome)continue;
 if(outcome==="deferredQuota"){quotaBlocked=true;break}
 batch.claimed++;batch[outcome]=(batch[outcome]??0)+1;processed++;
 }
 const result=await transaction(async s=>{const op=await scopedOp(a,w,o,s);const result=await summary(op,s);if(op.status!==result.status){op.status=result.status;op.increment();await op.save({session:s});result.version=op.version;}return result});quotaBlocked ||=result.blockedReason==="quota";
 if(!processed&&quotaBlocked)throw new AppError(429,"EMAIL_QUOTA_EXHAUSTED","The email allowance has been reached.",{operationId:o,pendingCount:result.pendingCount});
 return {operationId:o,batch,pendingCount:result.pendingCount,continueAllowed:result.continueAllowed,quotaBlocked};
}
export async function cancelOperation(a:AccountActor,w:string,o:string,version:number){
 return transaction(async s=>{const op=await scopedOp(a,w,o,s,true);
 if(op.status!=="cancelled"){
 if(op.version!==version)throw new AppError(409,"VERSION_CONFLICT","Refresh this email operation.");
 const jobs=await EmailJob.find({operationId:op._id,state:{$in:["pending","deferredQuota","retryableFailed","processing","needsReview"]}}).session(s);
 for(const job of jobs){
 const fields={cancelRequestedAt:new Date(),cancelReason:"operationCancelled"};
 if(!job.dispatchStartedAt&&job.quota?.state==="reserved"){
 for(const key of [job.quota.dayId,job.quota.monthId])await Usage.updateOne({_id:key,reserved:{$gt:0}},{$inc:{reserved:-1,version:1}},{session:s});
 }
 await EmailJob.updateOne({_id:job._id},{$set:{...fields,...(!job.dispatchStartedAt&&{state:"cancelled",...(job.quota?.state==="reserved"&&{"quota.state":"released"})})},$inc:{version:1}},{session:s});
 }
 op.status="cancelled";op.increment();await op.save({session:s});
 }
 const result=await summary(op,s);return {...result,cancellationPending:!!(result.counts.processing||result.counts.needsReview)};
 });
}
export async function listMail(a:AccountActor,w:string,params:{limit:number;cursor?:string;eventId?:string;kind?:typeof kinds[number];status?:InstanceType<typeof EmailOperation>["status"];state?:typeof jobStates[number]},o?:string){
 return transaction(async s=>{if(o) await scopedOp(a,w,o,s);else await weddingForMember(a,w,s);
 const cursorScope=JSON.stringify([scope(a,w),o,params.limit,params.eventId,params.kind,params.status,params.state]),pos=readPosition(params.cursor,cursorScope);
 const older=pos?{$or:[{createdAt:{$lt:new Date(pos.date)}},{createdAt:new Date(pos.date),_id:{$lt:id(pos.id)}}]}:{};
 const page=(rows:{_id:Types.ObjectId;createdAt:Date}[])=>({limit:params.limit,hasMore:rows.length>params.limit,nextCursor:rows.length>params.limit?writePosition(String(rows[params.limit-1]._id),rows[params.limit-1].createdAt,cursorScope):null});
 if(o){const rows=await EmailJob.find({operationId:id(o),weddingId:id(w),...older,...(params.state&&{state:params.state})}).sort({createdAt:-1,_id:-1}).limit(params.limit+1).session(s);return {data:rows.slice(0,params.limit).map(j=>({id:String(j._id),subjectType:j.subjectType,subjectId:String(j.subjectId),intendedRecipient:j.intendedRecipient,state:j.state,attemptCount:j.attemptCount,acceptedAt:j.acceptedAt,retryNotBefore:j.retryNotBefore,lastErrorCode:j.lastErrorCode})),page:page(rows)}}
 const rows=await EmailOperation.find({weddingId:id(w),kind:params.kind??{$in:kinds},...older,...(params.eventId&&{eventId:id(params.eventId)}),...(params.status&&{status:params.status})}).sort({createdAt:-1,_id:-1}).limit(params.limit+1).session(s);const data=[];for(const row of rows.slice(0,params.limit))data.push(await summary(row,s));return {data,page:page(rows)};
 });
}
