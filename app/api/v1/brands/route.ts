import { endpoint } from "@/lib/api/auth";
import { listBrands } from "@/lib/api/posts";
export const runtime = "nodejs";
export const GET = endpoint("brands:read", listBrands);
