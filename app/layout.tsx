import type { Metadata } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import "./globals.css";
import { assetPath } from "../lib/assetPath";

const uiSans = Manrope({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-code",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Wippa: Needlepoint Pattern Editing Tool",
  description: "Create and customize needlepoint patterns with ease.",
  icons: {
    icon: [
      { url: assetPath("/wippa_logo_icon.png"), type: "image/png" },
      { url: assetPath("/favicon.png"), type: "image/png" },
    ],
    shortcut: assetPath("/wippa_logo_icon.png"),
    apple: assetPath("/wippa_logo_icon.png"),
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
        className={`${uiSans.variable} ${geistMono.variable} antialiased`}
      >
        <div style={{ display: "grid", gap: 12, width: "100%", padding: "32px 24px 20px" }}>
          {children}
        </div>
      </body>
    </html>
  );
}
