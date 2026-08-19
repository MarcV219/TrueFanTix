import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import AppShell from "@/app/_components/app-shell";
import { absoluteUrl, DEFAULT_SOCIAL_IMAGE, safeJsonLd, SITE_NAME, SITE_URL } from "@/lib/seo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "TrueFanTix | Verified Tickets at or Below Face Value",
    template: `%s | ${SITE_NAME}`,
  },
  description: "Buy and sell verified event tickets at or below face value on TrueFanTix, the secure fan-first ticket marketplace.",
  applicationName: SITE_NAME,
  keywords: ["tickets", "event tickets", "face value tickets", "verified tickets", "ticket marketplace"],
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: SITE_URL,
    title: "TrueFanTix | Verified Tickets at or Below Face Value",
    description: "A secure, fan-first marketplace for verified event tickets at or below face value.",
    images: [{ url: DEFAULT_SOCIAL_IMAGE, alt: "TrueFanTix" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "TrueFanTix | Verified Tickets at or Below Face Value",
    description: "A secure, fan-first marketplace for verified event tickets at or below face value.",
    images: [DEFAULT_SOCIAL_IMAGE],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: absoluteUrl(DEFAULT_SOCIAL_IMAGE),
        description: "A secure, fan-first marketplace for verified event tickets at or below face value.",
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(organizationJsonLd) }} />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
