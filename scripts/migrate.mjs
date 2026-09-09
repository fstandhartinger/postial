import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 10 });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("Database migrations complete");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Database migration failed; check database connectivity and migration state.", message.replace(/postgres(ql)?:\/\/[^\s]+/g, "<db-url>").slice(0, 400));
  process.exitCode = 1;
} finally { await client.end(); }
