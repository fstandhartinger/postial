import { endpoint } from "@/lib/api/auth";
import { listPosts, createPost } from "@/lib/api/posts";
export const runtime = "nodejs";
export const GET = endpoint("posts:read", listPosts);
export const POST = endpoint("posts:write", createPost);

import { methodNotAllowed, options } from '@/lib/api/routing';
export const OPTIONS = options('GET, POST, HEAD, OPTIONS');
export const PUT = methodNotAllowed('GET, POST, HEAD, OPTIONS');
export const PATCH = methodNotAllowed('GET, POST, HEAD, OPTIONS');
export const DELETE = methodNotAllowed('GET, POST, HEAD, OPTIONS');
