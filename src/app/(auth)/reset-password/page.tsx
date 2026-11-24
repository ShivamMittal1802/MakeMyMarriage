import { accountConfigured } from "@/lib/config/server";
import { AuthFrame } from "@/modules/identity/components/auth-frame";
import { AuthForm } from "@/modules/identity/components/auth-form";
export const metadata = { title: "Choose a new password" };
export default function Page() {
  return (
    <AuthFrame
      title="Choose a new password"
      description="Use a password that’s unique to this account."
    >
      <AuthForm action="reset-password" configured={accountConfigured()} />
    </AuthFrame>
  );
}
