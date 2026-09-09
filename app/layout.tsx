import type { Metadata } from "next";
import localFont from "next/font/local";
import { Header } from "@/components/marketing/Header";
import { Footer } from "@/components/marketing/Footer";
import { SignInNotice } from "@/components/marketing/SignInNotice";
import { appUrl, description, words } from "@/components/marketing/copy";
import "./globals.css";
import { SiteFrame } from "@/components/app/site-frame";
const inter = localFont({
  src: [
    { path: "../public/fonts/Inter-latin-400.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/Inter-latin-500.woff2", weight: "500", style: "normal" },
    { path: "../public/fonts/Inter-latin-600.woff2", weight: "600", style: "normal" },
    { path: "../public/fonts/Inter-latin-700.woff2", weight: "700", style: "normal" },
  ],
  preload: false,
  variable: "--font-inter",
  display: "swap",
});
export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: words("SEO", "<title>"), template: "%s · SocialMint" },
  description,
  openGraph: {
    type: "website",
    siteName: "SocialMint",
    title: words("SEO", "OG title"),
    description: words("SEO", "OG description"),
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: words("SEO", "OG title"),
    description: words("SEO", "OG description"),
  },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={inter.variable}>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteFrame header={<Header notice={<SignInNotice />} />} footer={<Footer />}>
          {children}
        </SiteFrame>
      </body>
    </html>
  );
}
