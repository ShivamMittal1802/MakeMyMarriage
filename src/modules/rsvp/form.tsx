"use client";
import {useEffect,useState} from "react";
import {getJson,postJson,mutateJson} from "@/lib/http/client";
import type {GuestInvitationView} from "./service";
import {dayLabel,timeLabel} from "@/modules/events/time";
import s from "@/modules/events/events.module.css";
const message=(e:unknown)=>e instanceof Error?e.message:"Please try opening the invitation again.";
export function OpenInvitation({token}:{token?:string}){
const [error,setError]=useState("");
useEffect(()=>{let active=true;
const raw=token ?? new URLSearchParams(location.hash.slice(1)).get("token");
if(raw) void postJson<{cleanPath:string}>("/api/v1/access/rsvp",{token:raw}).then(result=>{if(active) location.replace(result.cleanPath)}).catch(e=>{if(active)setError(message(e))});
return ()=>{active=false};
},[token]);
return <main className={s.wrap}><h1>Your wedding invitation</h1><p role="status">{error||"Please use the complete private link from your invitation email to open your event."}</p></main>;
}
export function ResponseForm({id}:{id:string}){
const path="/api/v1/rsvp/"+encodeURIComponent(id);
const [view,setView]=useState<GuestInvitationView|null>(null),[status,setStatus]=useState(""),[busy,setBusy]=useState(false);
useEffect(()=>{let active=true;getJson<GuestInvitationView>(path).then(v=>{if(active)setView(v)}).catch(e=>{if(active)setStatus(message(e))});return ()=>{active=false}},[path]);
async function respond(response:"attending"|"declined"){
if(!view||busy)return;setBusy(true);setStatus("");
try{
 const saved=await mutateJson<Pick<GuestInvitationView,"response"|"respondedAt"|"version">>(path,"PATCH",{response,expectedVersion:view.version});
 setView({...view,...saved});setStatus("Your response has been saved.");
}catch(e){
 try{const current=await getJson<GuestInvitationView>(path);setView(current);setStatus(current.response===response?"Your response has been saved.":message(e))}catch(err){setView(null);setStatus(message(err))}
}finally{setBusy(false)}
}
return <main className={s.wrap}>{view?<><p>{view.couple?.brideName} &amp; {view.couple?.groomName}</p><h1>{view.event.name}</h1><p>{view.guestName}, you’re invited.</p><p>{dayLabel(view.event.startsAt)} · {timeLabel(view.event.startsAt)} IST</p>{view.event.endsAt&&<p>Ends {dayLabel(view.event.endsAt)} · {timeLabel(view.event.endsAt)} IST</p>}<p>{view.event.location}</p>{view.event.description&&<p>{view.event.description}</p>}<h2>Will you attend?</h2><p>Current response: {view.response==="pending"?"Awaiting your response":view.response==="attending"?"Attending":"Not attending"}</p><div className={s.actions}>{(["attending","declined"] as const).map(r=><button key={r} className={r==="attending"?s.primary:s.secondary} disabled={busy||view.response===r} onClick={()=>void respond(r)}>{r==="attending"?"Attending":"Not attending"}</button>)}</div><p><a href={view.publicWeddingUrl}>View the wedding website</a></p></>:<h1>Your wedding invitation</h1>}<p role="status">{status||(!view?"Loading invitation…":"")}</p></main>
}
