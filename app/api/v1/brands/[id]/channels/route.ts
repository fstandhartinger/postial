import { endpoint } from "@/lib/api/auth";
import { listChannels } from "@/lib/api/posts";
export const runtime = "nodejs";
export const GET = endpoint("brands:read", listChannels);
