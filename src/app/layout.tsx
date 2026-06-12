import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Spectral } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const spectral = Spectral({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-spectral",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Proposal Engine — Bid & Tender Response Registry",
  description:
    "AI-powered bid response engine: parse RFPs, match capabilities, flag compliance gaps, score win probability, draft compliant proposals.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${spectral.variable} ${plexSans.variable} ${plexMono.variable} min-h-screen flex flex-col antialiased`}
      >
        <div className="h-1.5 bg-ink" />
        <header className="border-b border-line">
          <div className="mx-auto max-w-6xl px-6 py-3 flex items-baseline justify-between gap-4">
            <Link href="/" className="group flex items-baseline gap-3">
              <span className="font-mono text-[0.65rem] tracking-[0.25em] uppercase text-ink-faint group-hover:text-oxide transition-colors">
                Reg. No. PE-2026
              </span>
              <span className="font-display text-xl font-semibold tracking-tight">
                Proposal Engine
              </span>
            </Link>
            <span className="hidden sm:block font-mono text-[0.65rem] tracking-[0.2em] uppercase text-ink-faint">
              Bid &amp; Tender Response Registry
            </span>
          </div>
        </header>

        <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-8">{children}</main>

        <footer className="border-t border-line mt-12">
          <div className="mx-auto max-w-6xl px-6 py-4 flex flex-wrap justify-between gap-2 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-ink-faint">
            <span>Axiom Digital Systems (Pvt) Ltd — internal tooling</span>
            <span>CUST Hackathon · Problem No. 1 · Procurement &amp; Sourcing</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
