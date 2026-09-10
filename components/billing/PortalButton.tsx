"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
export function PortalButton({label = "Manage billing"}:{label?:string}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function openPortal() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/stripe/portal", { method: "POST" });
      if (response.status === 401) { router.push("/login?next=/app/billing"); return; }
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error ?? "We couldn’t open billing. Try again. If it still fails, contact support.");
      window.location.assign(data.url);
    } catch (error) {
      setError(error instanceof Error ? error.message : "We couldn’t open billing. Try again. If it still fails, contact support.");
      setBusy(false);
    }
  }
  return <><Button type="button" disabled={busy} onClick={openPortal}>{busy ? "Opening billing…" : label}</Button>{error && <p role="alert">{error}</p>}</>;
}
