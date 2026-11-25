import {ResponseForm} from "@/modules/rsvp/form";
export const metadata={robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{invitationId:string}>}){return <ResponseForm id={(await params).invitationId}/>}
