import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool";
import { findRepoRoot } from "../../config/paths";

/**
 * Migrations, applied at boot.
 *
 * Small on purpose. A real service would reach for a migration tool with
 * rollbacks and checksums; at this size that is more machinery than the problem
 * deserves, and the shape that matters — versioned files, applied once, recorded
 * — is the same either way.
 *
 * Each file runs inside a transaction with its version recorded in the same
 * commit, so a migration cannot half-apply and then be skipped on the next boot.
 * Failure is fatal: a schema we can't reason about is worse than not starting.
 */

// Found rather than counted — see config/paths for why that distinction bit once
// already.
const MIGRATIONS_DIR = join(
  findRepoRoot(dirname(fileURLToPath(import.meta.url))),
  "db/migrations",
);

export async function migrate(): Promise<void> {
  if (!pool) return;

  if (!existsSync(MIGRATIONS_DIR)) {
    console.warn(`[db] no migrations directory at ${MIGRATIONS_DIR}, skipping`);
    return;
  }

  await pool.query(`
    create table if not exists schema_migrations (
      version    text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const { rows } = await pool.query(`select version from schema_migrations`);
  const applied = new Set(rows.map((r: { version: string }) => r.version));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 001_, 002_ … lexicographic is chronological by convention

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(`insert into schema_migrations (version) values ($1)`, [file]);
      await client.query("commit");
      console.log(`[db] applied ${file}`);
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
}
