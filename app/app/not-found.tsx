import Link from "next/link";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
export default function NotFound() {
  return (
    <Card role="alert" className="w-full max-w-2xl space-y-4 break-words">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Postial</p>
      <h1>This page isn’t in your workspace</h1>
      <p>The address may be wrong or this page may have moved.</p>
      <Link href="/app" className={buttonClass}>
        Back to overview
      </Link>
      <p className="text-sm text-zinc-600">Need help? Email <Link className="underline" href="mailto:info@productivity-boost.com">info@productivity-boost.com</Link>.</p>
    </Card>
  );
}
