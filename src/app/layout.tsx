import type { Metadata } from "next";
import { plexMono, plexSans } from "./fonts";
import "./globals.css";

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
