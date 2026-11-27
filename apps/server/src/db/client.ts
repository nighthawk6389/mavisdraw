import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { config } from '../config.js';

const connectionString = config.databaseUrl;

const queryClient = postgres(connectionString);

export const db = drizzle(queryClient, { schema });

/** Close the connection pool (command-line scripts, so the process can exit). */
export async function closeDb(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}

export type Database = typeof db;
