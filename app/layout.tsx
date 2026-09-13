import type { Metadata } from "next";
import { Geist, Geist_Mono, Cedarville_Cursive } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const cedarvilleCursive = Cedarville_Cursive({
  variable: "--font-cedarville-cursive",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "pond",
  description: "pond",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${cedarvilleCursive.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
