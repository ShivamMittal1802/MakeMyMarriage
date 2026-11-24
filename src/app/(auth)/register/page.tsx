import { identityConfigured } from "@/lib/config/server";
import { AuthFrame } from "@/modules/identity/components/auth-frame";
import { AuthForm } from "@/modules/identity/components/auth-form";
export const metadata = { title: "Your next chapter starts here" };
export default function Page() {
  return (
    <AuthFrame
      title="Your next chapter starts here"
      description="Create an account for the wedding you’re planning together."
    >
      <AuthForm action="register" configured={identityConfigured()} />
    </AuthFrame>
  );
}
