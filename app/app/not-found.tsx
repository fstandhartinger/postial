import Link from "next/link";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
export default function NotFound() {
  return (
    <Card className="space-y-4">
      <h1>This page isn’t in your workspace</h1>
      <p>It may have been removed, or the link may be incorrect.</p>
      <Link href="/app" className={buttonClass}>
        Back to overview
      </Link>
    </Card>
  );
}
