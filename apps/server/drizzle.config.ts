import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  // Applied at deploy by src/db/migrate.ts (not db:push)
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://mavisdraw:mavisdraw_dev@localhost:5432/mavisdraw',
  },
});
