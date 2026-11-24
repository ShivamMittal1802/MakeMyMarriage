import { accountConfigured } from "@/lib/config/server";
import { AuthFrame } from "@/modules/identity/components/auth-frame";
import { AuthForm } from "@/modules/identity/components/auth-form";
export const metadata = { title: "Welcome back" };
export default function Page() {
  return (
    <AuthFrame
      title="Welcome back"
      description="Log in to manage your wedding together."
    >
      <AuthForm action="login" configured={accountConfigured()} />
    </AuthFrame>
  );
}
