import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

/**
 * Apply database migrations (run at deploy, before the new server starts).
 *
 * Databases created with `db:push` before migrations existed have the
 * tables but no migration history. Those are adopted: the baseline (the
 * schema they were pushed with) is recorded as applied, and the following
 * migrations — written to be re-runnable — bring them up to date. A fresh
 * database simply runs everything.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/server/drizzle — the same from src/db (tsx) and dist/db (node). */
export const MIGRATIONS_FOLDER = path.resolve(here, '../../drizzle');

interface Journal {
  entries: Array<{ idx: number; when: number; tag: string }>;
}

type Sql = ReturnType<typeof postgres>;

async function adoptPushedDatabase(sql: Sql, log: (msg: string) => void): Promise<boolean> {
  const [{ has_history }] = await sql<{ has_history: boolean }[]>`
    select to_regclass('drizzle.__drizzle_migrations') is not null as has_history`;
  if (has_history) return false;
  const [{ has_tables }] = await sql<{ has_tables: boolean }[]>`
    select to_regclass('public.users') is not null as has_tables`;
  if (!has_tables) return false; // a fresh database: run every migration

  const journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
  ) as Journal;
  const baseline = journal.entries[0];
  // Same hash drizzle's migrator records (sha256 of the file)
  const contents = readFileSync(path.join(MIGRATIONS_FOLDER, `${baseline.tag}.sql`)).toString();
  const hash = createHash('sha256').update(contents).digest('hex');
  await sql`create schema if not exists drizzle`;
  await sql`create table if not exists drizzle.__drizzle_migrations (
    id serial primary key, hash text not null, created_at bigint)`;
  await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${baseline.when})`;
  log(`Adopted an existing database (created with db:push): recorded ${baseline.tag} as applied`);
  return true;
}

export async function runMigrations(
  databaseUrl: string,
  log: (msg: string) => void = (m) => console.log(`[migrate] ${m}`),
): Promise<{ adopted: boolean }> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const adopted = await adoptPushedDatabase(sql, log);
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER });
    log('Database is up to date');
    return { adopted };
  } finally {
    await sql.end();
  }
}

// `tsx src/db/migrate.ts` / `node dist/db/migrate.js`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { config } = await import('../config.js');
  runMigrations(config.databaseUrl).catch((err) => {
    console.error('[migrate] Failed:', err);
    process.exit(1);
  });
}
