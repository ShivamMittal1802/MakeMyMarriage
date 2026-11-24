import { identityConfigured } from "@/lib/config/server";
import { AuthFrame } from "@/modules/identity/components/auth-frame";
import { AuthForm } from "@/modules/identity/components/auth-form";
export const metadata = { title: "Let’s get you back in" };
export default function Page() {
  return (
    <AuthFrame
      title="Let’s get you back in"
      description="Enter your email to request a password reset link."
    >
      <AuthForm action="forgot-password" configured={identityConfigured()} />
    </AuthFrame>
  );
}
