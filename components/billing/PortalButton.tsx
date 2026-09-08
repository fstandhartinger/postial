"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
export function PortalButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function openPortal() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error ?? "Unable to open billing");
      window.location.assign(data.url);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to open billing");
      setBusy(false);
    }
  }
  return <><Button type="button" disabled={busy} onClick={openPortal}>{busy ? "Opening billing…" : "Manage billing"}</Button>{error && <p role="alert">{error}</p>}</>;
}
