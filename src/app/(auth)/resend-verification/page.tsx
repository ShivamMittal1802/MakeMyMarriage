import { identityConfigured } from "@/lib/config/server";
import { AuthFrame } from "@/modules/identity/components/auth-frame";
import { AuthForm } from "@/modules/identity/components/auth-form";
export const metadata = { title: "A fresh start for your inbox" };
export default function Page() {
  return (
    <AuthFrame
      title="A fresh start for your inbox"
      description="Request a new email verification link."
    >
      <AuthForm
        action="resend-verification"
        configured={identityConfigured()}
      />
    </AuthFrame>
  );
}
