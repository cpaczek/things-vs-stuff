import type { Metadata, Viewport } from "next";
import { Patrick_Hand, Gochi_Hand, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const hand = Patrick_Hand({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-hand",
});

const marker = Gochi_Hand({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-marker",
});

const mono = IBM_Plex_Mono({
  weight: ["400", "600"],
  subsets: ["latin"],
  variable: "--font-mono",
});

// Game controls: fixed scale so drags never fight pinch-zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "THINGS vs STUFF — anything can fight anything",
  description:
    "A daily doodle tower defense where anything can fight anything. Opera singers shatter glass golems. Rain waters the plant monsters (oops). Fuse a campfire into a tornado. New things every day.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${hand.variable} ${marker.variable} ${mono.variable}`}>
        {children}
      </body>
    </html>
  );
}
