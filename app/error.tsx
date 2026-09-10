"use client";

import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-12" role="alert">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Postial</p>
      <h1 className="text-3xl font-semibold">Something went wrong</h1>
      <p>We couldn’t finish loading this page. We don’t know why yet.</p>
      <button type="button" onClick={reset} className="rounded bg-emerald-700 px-5 py-3 font-semibold text-white">Try again</button>
      <p className="text-sm text-zinc-600">Still stuck? Contact <Link className="underline" href="mailto:info@productivity-boost.com">info@productivity-boost.com</Link>{error.digest ? ` and mention reference ${error.digest.slice(0, 12)}.` : "."}</p>
    </main>
  );
}
