import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
export const dbPoolOptions = { prepare: false, max: 5, connect_timeout: 10, idle_timeout: 60 };
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  return drizzle(postgres(url, dbPoolOptions), { schema });
}
let instance: ReturnType<typeof createDb> | undefined;
export function getDb() { return instance ??= createDb(); }
