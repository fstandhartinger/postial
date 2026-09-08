"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
export function CopyLink({ link }: { link: string }) {
  const [message, setMessage] = useState("");
  return <div className="space-y-2">
    <label className="block">Client approval link<input className="mt-2 w-full rounded border p-3" readOnly value={link} onFocus={(e) => e.target.select()} /></label>
    <Button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(link); setMessage("Link copied."); }
      catch { setMessage("Select the link above and copy it manually."); }
    }}>Copy link</Button>
    <p role="status">{message}</p>
  </div>;
}
