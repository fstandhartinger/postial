import { endpoint } from "@/lib/api/auth";
import { listBrands } from "@/lib/api/posts";
export const runtime = "nodejs";
export const GET = endpoint("brands:read", listBrands);

import { methodNotAllowed, options } from '@/lib/api/routing';
export const OPTIONS = options('GET, HEAD, OPTIONS');
export const POST = methodNotAllowed('GET, HEAD, OPTIONS');
export const PUT = methodNotAllowed('GET, HEAD, OPTIONS');
export const PATCH = methodNotAllowed('GET, HEAD, OPTIONS');
export const DELETE = methodNotAllowed('GET, HEAD, OPTIONS');
