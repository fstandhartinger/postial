import { endpoint } from "@/lib/api/auth";
import { getPost, deletePost } from "@/lib/api/posts";
export const runtime = "nodejs";
export const GET = endpoint("posts:read", getPost);
export const DELETE = endpoint("posts:write", deletePost);

import { methodNotAllowed, options } from '@/lib/api/routing';
export const OPTIONS = options('GET, DELETE, HEAD, OPTIONS');
export const POST = methodNotAllowed('GET, DELETE, HEAD, OPTIONS');
export const PUT = methodNotAllowed('GET, DELETE, HEAD, OPTIONS');
export const PATCH = methodNotAllowed('GET, DELETE, HEAD, OPTIONS');
