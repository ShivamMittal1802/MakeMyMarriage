import { accountConfigured } from "@/lib/config/server";
import { AuthFrame } from "@/modules/identity/components/auth-frame";
import { AuthForm } from "@/modules/identity/components/auth-form";
export const metadata = { title: "Verify your email" };
export default function Page() {
  return (
    <AuthFrame
      title="Verify your email"
      description="Confirm your email using the link we sent you."
    >
      <AuthForm action="verify-email" configured={accountConfigured()} />
    </AuthFrame>
  );
}
