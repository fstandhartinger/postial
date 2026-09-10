import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-12" role="alert">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Postial</p>
      <h1 className="text-3xl font-semibold">We couldn’t find that page</h1>
      <p>The address may be wrong or the page may have moved.</p>
      <Link href="/" className="inline-block rounded bg-emerald-700 px-5 py-3 font-semibold text-white">Go to Postial</Link>
      <p className="text-sm text-zinc-600">Need help? Email <Link className="underline" href="mailto:info@productivity-boost.com">info@productivity-boost.com</Link>.</p>
    </main>
  );
}
