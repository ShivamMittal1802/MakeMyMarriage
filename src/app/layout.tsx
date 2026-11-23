import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";

import "./globals.css";

const inter = localFont({
  src: "./fonts/inter.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "400 700",
});

const playfair = localFont({
  src: [
    {
      path: "./fonts/playfair-display.woff2",
      weight: "400 600",
      style: "normal",
    },
    {
      path: "./fonts/playfair-display-italic.woff2",
      weight: "400 600",
      style: "italic",
    },
  ],
  variable: "--font-playfair",
  display: "swap",
});

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Make My Marriage",
  description:
    "Your wedding, beautifully organised. Bring events, guest invitations, expenses, and wedding memories together in one shared space.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body>{children}</body>
    </html>
  );
}
