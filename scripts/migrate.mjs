import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 10 });
let isolatedMigrations;
try {
  const migrationsSchema = process.env.MIGRATIONS_SCHEMA || "drizzle";
  let migrationsFolder = "./drizzle";
  if (process.env.MIGRATIONS_SCHEMA) {
    isolatedMigrations = mkdtempSync(join(tmpdir(), "postial-migrations-"));
    for (const file of readdirSync("./drizzle")) {
      const source = join("./drizzle", file), target = join(isolatedMigrations, file);
      if (file.endsWith(".sql")) writeFileSync(target, readFileSync(source, "utf8").replaceAll('"public".', `"${migrationsSchema}".`));
      else cpSync(source, target, { recursive: true });
    }
    migrationsFolder = isolatedMigrations;
  }
  await migrate(drizzle(client), { migrationsFolder, migrationsSchema });
  console.log("Database migrations complete");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Database migration failed; check database connectivity and migration state.", message.replace(/postgres(ql)?:\/\/[^\s]+/g, "<db-url>").slice(0, 800));
  process.exitCode = 1;
} finally { await client.end(); if (isolatedMigrations) rmSync(isolatedMigrations, { recursive: true, force: true }); }
