import Link from "next/link";
import { signIn } from "@/auth";
import { configuredProviders } from "@/lib/auth-providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
export const dynamic = "force-dynamic";
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const enabled = configuredProviders();
  const params = await searchParams;
  return <Card className="mx-auto max-w-md"><h1 className="text-3xl font-semibold">Welcome to SocialMint</h1><p className="mt-3 text-gray-600">Your brands, together in one place.</p>
    {!enabled.google && !enabled.email && <p className="mt-6 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">We’re getting sign-in ready. Please come back soon.</p>}
    {params.error && <p role="alert" className="mt-4 text-sm text-red-700">We couldn’t sign you in. Please try again.</p>}
    {params.sent && <p role="status" className="mt-4 text-sm text-emerald-800">Check your inbox for your sign-in link.</p>}
    <form className="mt-7" action={async () => { "use server"; if (configuredProviders().google) await signIn("google", { redirectTo: "/app" }); }}><Button className="w-full" disabled={!enabled.google}>Continue with Google{!enabled.google && " — coming soon"}</Button></form>
    <form className="mt-6 space-y-3" action={async (data: FormData) => { "use server"; if (configuredProviders().email) await signIn("nodemailer", { email: data.get("email"), redirectTo: "/app" }); }}><label className="text-sm font-medium" htmlFor="email">Email address</label><Input id="email" name="email" type="email" autoComplete="email" placeholder="you@agency.com" required disabled={!enabled.email} /><Button className="w-full" disabled={!enabled.email}>Send magic link{!enabled.email && " — coming soon"}</Button></form>
    <Link className="mt-7 inline-block text-sm text-gray-600 underline underline-offset-4" href="/">Back to home</Link>
  </Card>;
}
