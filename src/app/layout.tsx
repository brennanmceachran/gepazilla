import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteOrigin = "https://gepazilla.com";

export const metadata: Metadata = {
  title: "GEPAzilla | GEPA Prompt Optimizer",
  description:
    "GEPAzilla is the open-source GEPA prompt optimization toolkit with scoring, telemetry, and reflection in one console.",
  icons: {
    icon: "/favicon.png",
  },
  openGraph: {
    title: "GEPAzilla | GEPA Prompt Optimizer",
    description:
      "GEPAzilla helps you iterate on prompts with GEPA: datasets, scorers, telemetry, and reflection—open source and local-first.",
    url: siteOrigin,
    siteName: "GEPAzilla",
    images: [
      {
        url: `${siteOrigin}/opengraph-image`,
        width: 1200,
        height: 630,
        alt: "GEPAzilla mascot at the console",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "GEPAzilla | GEPA Prompt Optimizer",
    description:
      "Open-source GEPA prompt optimizer with scoring, telemetry, and reflection.",
    images: [`${siteOrigin}/opengraph-image`],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
