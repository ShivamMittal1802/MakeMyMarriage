import "server-only";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import {
  authenticateCredentials,
  currentSessionUser,
} from "@/modules/identity/service";
import { appOrigin } from "@/lib/config/server";
import { AppError } from "@/lib/http/errors";

class AccountUnavailable extends CredentialsSignin {
  code = "unavailable";
}
class AttemptsExceeded extends CredentialsSignin {
  code = "rate_limited";
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  useSecureCookies: appOrigin().startsWith("https:"),
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Credentials({
      credentials: { email: { type: "email" }, password: { type: "password" } },
      async authorize(credentials) {
        try {
          return await authenticateCredentials({
            email: credentials.email,
            password: credentials.password,
          });
        } catch (error) {
          if (error instanceof AppError && error.status === 429)
            throw new AttemptsExceeded();
          throw new AccountUnavailable();
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.sessionVersion = user.sessionVersion;
      }
      const current = await currentSessionUser(token.sub, token.sessionVersion);
      if (!current) return null;
      token.name = current.name;
      token.email = current.emailNormalized;
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub!;
      session.user.name = token.name;
      session.user.email = token.email ?? "";
      return session;
    },
    redirect({ url }) {
      const baseUrl = appOrigin();
      // Authentication returns only to this application's account entry point.
      const target = new URL("/onboarding", baseUrl);
      if (url === "/" || url === baseUrl || url === new URL("/", baseUrl).href)
        return baseUrl;
      return target.href;
    },
  },
  logger: {
    error(error) {
      const code =
        "type" in error && typeof error.type === "string"
          ? error.type
          : "UNKNOWN";
      if (code !== "CredentialsSignin")
        console.error("authentication_failed", { code });
    },
    warn(code) {
      console.warn("authentication_warning", { code });
    },
    debug() {},
  },
}));
