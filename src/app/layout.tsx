import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/*
 * IBM Plex carries an engineering register that the usual interface faces do
 * not: it was drawn for technical documentation, and its mono companion is what
 * makes a column of document numbers scannable. Both load as CSS variables so
 * the two families can be mixed inside a single line.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tadbeerly — Help Desk",
  description:
    "Help desk ticketing: requests, routing, SLAs and self-service.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-full font-sans antialiased">{children}</body>
    </html>
  );
}
