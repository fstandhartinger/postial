import { endpoint } from "@/lib/api/auth";
import { retryPost } from "@/lib/api/posts";
export const runtime = "nodejs";
export const POST = endpoint("posts:write", retryPost);
