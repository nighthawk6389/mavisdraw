import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bring the database schema up to date the same way a deploy does (the
 * migrations, not db:push), so the suite also proves they work.
 * Tests create their own users/projects, so no truncation is needed.
 */
export default async function globalSetup(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const serverDir = path.resolve(here, '../../server');
  const databaseUrl =
    process.env.E2E_DATABASE_URL ??
    'postgresql://mavisdraw:mavisdraw_dev@localhost:5432/mavisdraw';

  execSync('pnpm exec tsx src/db/migrate.ts', {
    cwd: serverDir,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
