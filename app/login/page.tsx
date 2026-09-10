import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginTarget, internalPath } from "@/lib/login-target";
import { signIn } from "@/auth";
import { configuredProviders } from "@/lib/auth-providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { recordFunnelEvent } from '@/lib/funnel';
import { seoMetadata } from '@/lib/seo';
export const dynamic = "force-dynamic";
export const metadata = seoMetadata({ title: 'Sign in to Postial', description: 'Sign in to your Postial workspace with Google or a magic link to manage brands, posts, channels, approvals, and publishing.', path: '/login', robots: { index: false, follow: false } });
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; plan?: string; callbackUrl?: string }> }) {
  const enabled = configuredProviders();
  const params = await searchParams;
  // Auth.js error/verification redirects may retain the destination as callbackUrl.
  const jar = await cookies();
  const callbackUrl = params.callbackUrl ?? jar.get("__Secure-authjs.callback-url")?.value ?? jar.get("authjs.callback-url")?.value;
  let callbackPath = internalPath(callbackUrl);
  if (!callbackPath && callbackUrl) {
    try {
      const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? '').origin;
      const url = new URL(callbackUrl);
      if (url.origin === origin) callbackPath = internalPath(url.pathname + url.search);
    } catch { /* Invalid destinations fall back to the workspace. */ }
  }
  const redirectTo = params.next || params.plan ? loginTarget(params.next, params.plan) : callbackPath ?? '/app';
  return <Card className="mx-auto max-w-md"><h1 className="text-3xl font-semibold">Welcome to Postial</h1><p className="mt-3 text-gray-600">Your brands, together in one place.</p>
    {!enabled.google && !enabled.email && <p className="mt-6 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">We’re getting sign-in ready. Please come back soon.</p>}
    {params.error && <p role="alert" className="mt-4 text-sm text-red-700">We couldn’t sign you in. Please try again.</p>}
    {/* Each provider keeps its own form, so Enter inside the email field submits the magic-link form instead of starting the Google flow. */}
    <form className="mt-7" action={async () => { "use server"; await recordFunnelEvent('signup_started'); if (configuredProviders().google) await signIn("google", { redirectTo }); }}><Button className="w-full" disabled={!enabled.google}>Continue with Google{!enabled.google && " — coming soon"}</Button></form>
    <form className="mt-6 space-y-3" action={async (data: FormData) => { "use server"; if (!configuredProviders().email) return; const email = String(data.get("email") ?? "");
      // redirect: false surfaces delivery or configuration errors as error-page redirects instead of showing the confirmation page.
      await recordFunnelEvent('signup_started'); const url = await signIn("nodemailer", { email, redirectTo, redirect: false });
      if (typeof url === "string" && url.includes("error=")) redirect(url);
      redirect("/login/check-email?email=" + encodeURIComponent(email.trim()));
    }}><label className="text-sm font-medium" htmlFor="email">Email address</label><Input id="email" name="email" type="email" autoComplete="email" placeholder="you@agency.com" required disabled={!enabled.email} /><Button className="w-full" disabled={!enabled.email}>Send magic link{!enabled.email && " — coming soon"}</Button></form>
    <Link className="mt-7 inline-block text-sm text-gray-600 underline underline-offset-4" href="/">Back to home</Link>
  </Card>;
}
