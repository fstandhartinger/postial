import { timingSafeEqual } from "node:crypto";
import { tick } from "@/lib/publishing";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET,
    supplied = request.headers.get("x-cron-secret");
  if (
    !expected ||
    !supplied ||
    Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await tick());
  } catch {
    return Response.json(
      { error: "Publishing is temporarily unavailable" },
      { status: 503 },
    );
  }
}
