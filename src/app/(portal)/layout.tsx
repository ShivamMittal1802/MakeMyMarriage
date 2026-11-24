import type { ReactNode } from "react";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default function PortalLayout({ children }: { children: ReactNode }) {
  return children;
}
