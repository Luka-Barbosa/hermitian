import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], weight: ["200", "300"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], weight: ["300", "400"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Hermitian",
  description: "Read-only payments analytics over synthetic data. The model chooses; code computes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
