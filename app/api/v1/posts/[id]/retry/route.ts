import { endpoint } from "@/lib/api/auth";
import { retryPost } from "@/lib/api/posts";
export const runtime = "nodejs";
export const POST = endpoint("posts:write", retryPost);

import { methodNotAllowed, options } from '@/lib/api/routing';
export const OPTIONS = options('POST, OPTIONS');
export const GET = methodNotAllowed('POST, OPTIONS');
export const PUT = methodNotAllowed('POST, OPTIONS');
export const PATCH = methodNotAllowed('POST, OPTIONS');
export const DELETE = methodNotAllowed('POST, OPTIONS');
export const HEAD = methodNotAllowed('POST, OPTIONS');
