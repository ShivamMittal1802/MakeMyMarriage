import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Make My Marriage",
  description:
    "A shared space to plan your wedding, bring people together, and celebrate.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
