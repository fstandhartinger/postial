import type { Metadata } from "next";
import localFont from "next/font/local";
import { Header } from "@/components/marketing/Header";
import { Footer } from "@/components/marketing/Footer";
import { appUrl, description, words } from "@/components/marketing/copy";
import "./globals.css";
import { SiteFrame } from "@/components/app/site-frame";
const inter = localFont({
  src: "../public/fonts/InterVariable.woff2",
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
        <SiteFrame header={<Header />} footer={<Footer />}>
          {children}
        </SiteFrame>
      </body>
    </html>
  );
}
