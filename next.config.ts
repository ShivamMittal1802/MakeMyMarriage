import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep development startup from generating repository instruction files.
  agentRules: false,
  async headers() {
    return [
      "/",
      "/login",
      "/register",
      "/verify-email",
      "/resend-verification",
      "/forgot-password",
      "/reset-password",
      "/onboarding",
      "/join/:path*",
      "/invitations/:path*",
      "/rsvp/:path*",
      "/gallery/:path*",
      "/dashboard/:path*",
    ].map((source) => ({
      source,
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "private, no-store" },
      ],
    }));
  },
};

export default nextConfig;
