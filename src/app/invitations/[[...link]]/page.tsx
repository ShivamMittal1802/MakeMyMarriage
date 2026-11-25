import {OpenInvitation} from "@/modules/rsvp/form";
export const metadata={robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{link?:string[]}>}){
const {link}=await params;return <OpenInvitation token={link?.length===1?link[0]:undefined}/>;
}
