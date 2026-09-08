import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import { auth } from "@/auth";
import "./globals.css";
export const dynamic = "force-dynamic";
const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
export const metadata: Metadata = { title: { default: "SocialMint", template: "%s · SocialMint" }, description: "Approve and publish social posts across brands." };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = process.env.DATABASE_URL && process.env.AUTH_SECRET ? await auth() : null;
  return <html lang="en"><body className={`${geist.variable} flex min-h-screen flex-col font-sans antialiased`}>
    <header className="border-b border-gray-200 bg-white"><nav aria-label="Main navigation" className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
      <Link href="/" className="text-xl font-bold tracking-tight">Social<span className="text-emerald-600">Mint</span></Link>
      <div className="flex items-center gap-5 text-sm font-medium"><Link href="/pricing">Pricing</Link><Link href={session ? "/app" : "/login"}>{session ? "Account" : "Login"}</Link></div>
    </nav></header>
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 sm:py-20">{children}</main>
    <footer className="border-t border-gray-200"><div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-5 px-6 py-8 text-sm text-gray-600"><span>© {new Date().getFullYear()} SocialMint</span><nav aria-label="Legal" className="flex gap-5"><Link href="/impressum">Impressum</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav></div></footer>
  </body></html>;
}
