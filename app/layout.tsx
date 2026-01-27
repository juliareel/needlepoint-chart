import type { Metadata } from "next";
import { Nunito, Geist_Mono } from "next/font/google";
import "./globals.css";

const uiSans = Nunito({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-code",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Needlepoint Pattern Editor",
  description: "Create and customize needlepoint patterns with ease.",
  icons: {
    icon: "/favicon.png",
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
        <div style={{ display: "grid", gap: 20, width: "100%", padding: "32px 24px 20px" }}>
          <div
            style={{
              textAlign: "center",
              fontWeight: 600,
              fontSize: 34,
              letterSpacing: "0.02em",
              fontFamily: "var(--font-ui), ui-sans-serif, system-ui",
              marginBottom: 10,
            }}
          >
            Needlepoint Pattern Editor
          </div>
          {children}
        </div>
      </body>
    </html>
  );
}
