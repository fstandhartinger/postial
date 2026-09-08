import postgres from "postgres";
import { version } from "@/package.json";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ ok: false }, { status: 503 });
  const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 2 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([client`select 1`, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 2000); })]);
    return Response.json({ ok: true, db: true, version });
  } catch { return Response.json({ ok: false }, { status: 503 }); }
  finally { clearTimeout(timer); void client.end({ timeout: 0 }).catch(() => {}); }
}
