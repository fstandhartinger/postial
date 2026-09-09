import { endpoint } from "@/lib/api/auth";
import { listPosts, createPost } from "@/lib/api/posts";
export const runtime = "nodejs";
export const GET = endpoint("posts:read", listPosts);
export const POST = endpoint("posts:write", createPost);
