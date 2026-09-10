import Link from "next/link";
import { Card } from "@/components/ui/card";
import { seoMetadata } from '@/lib/seo';
import { signInLinkLifetime, SIGN_IN_LINK_MAX_AGE_SECONDS } from '@/lib/auth-email';
export const dynamic = "force-dynamic";
const linkLifetime = signInLinkLifetime(SIGN_IN_LINK_MAX_AGE_SECONDS);
export const metadata = seoMetadata({ title: 'Check your Postial sign-in email', description: `Postial sign-in links arrive by email and expire after ${linkLifetime}; check your inbox or spam folder before trying again to access your workspace.`, path: '/login/check-email', robots: { index: false, follow: false } });
export default async function CheckEmail({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const params = await searchParams;
  // The login form passes the address it submitted; Auth.js internal verify-request redirects omit it.
  const email = typeof params.email === "string" ? params.email.slice(0, 254) : undefined;
  // Keep this promise in sync with the Nodemailer provider's configured maxAge.
  return <Card className="mx-auto max-w-md"><h1 className="text-3xl font-semibold">Check your email</h1>
    <p className="mt-4 text-gray-600">We sent a Postial sign-in link to {email ? <strong className="font-medium text-gray-900">{email}</strong> : "your email address"}. It is valid for {linkLifetime} and works only once. If it doesn’t arrive, check your spam folder, confirm the address, and request a new link.</p>
    <Link className="mt-7 inline-block text-sm text-gray-600 underline underline-offset-4" href="/login">Use a different email</Link>
  </Card>;
}
