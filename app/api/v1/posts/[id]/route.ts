import { endpoint } from "@/lib/api/auth";
import { getPost, deletePost } from "@/lib/api/posts";
export const runtime = "nodejs";
export const GET = endpoint("posts:read", getPost);
export const DELETE = endpoint("posts:write", deletePost);
