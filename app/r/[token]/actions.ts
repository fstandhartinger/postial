"use server";
import { headers } from "next/headers";
import { isIP } from "node:net";
import { decideApproval } from "@/lib/approvals";
export async function submitApproval(token: string, form: FormData) {
  const h = await headers();
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL;
  if (!configured || h.get("origin") !== new URL(configured).origin || h.get("sec-fetch-site") === "cross-site")
    return { status: 403, error: "Please submit from the approval page." };
  // Enable only behind a proxy that overwrites X-Real-IP. Without that contract,
  // share the token's limit rather than trusting caller-controlled forwarding.
  const forwarded = process.env.APPROVAL_TRUST_PROXY === "true" ? h.get("x-real-ip") : null;
  const ip = forwarded && isIP(forwarded) ? forwarded : "untrusted-peer";
  return decideApproval(token, {
    reviewerName: form.get("reviewerName"), comment: form.get("comment"), decision: form.get("decision"), approvalVersion: form.get("approvalVersion"),
  }, ip);
}
