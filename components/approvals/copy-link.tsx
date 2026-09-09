"use client";
import { recordApprovalCopy } from "@/components/app/approval-share";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Button } from "@/components/ui/button";
export function CopyLink({ link, postId }: { link: string; postId?: string }) {
  const [message, setMessage] = useState("");
  return (
    <div className="space-y-2">
      <label className="block">
        Client approval link
        <Input
          className="mt-2 w-full rounded border p-3"
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
        />
      </label>
      <Button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setMessage("Link copied. Paste it into a message to your client.");
            if (postId) {
              try {
                await recordApprovalCopy(postId);
              } catch {
                setMessage(
                  "Link copied. Progress could not be saved; try copying again.",
                );
              }
            }
          } catch {
            setMessage("Select the link above and copy it manually.");
          }
        }}
      >
        Copy link
      </Button>
      <p role="status">{message}</p>
    </div>
  );
}
