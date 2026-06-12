import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Proposal Engine",
  description:
    "AI-Powered Bid & Proposal Response Engine — parse RFPs, match capabilities, draft compliant responses, score win probability.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
