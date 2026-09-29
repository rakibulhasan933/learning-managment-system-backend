import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

export function createDatabase(databaseUrl: string) {
  // Supabase's transaction pooler is incompatible with prepared statements.
  const client = postgres(databaseUrl, { prepare: false });
  const db = drizzle({ client, schema });

  return { client, db };
}

export type Database = ReturnType<typeof createDatabase>['db'];
export type DatabaseClient = ReturnType<typeof createDatabase>['client'];
