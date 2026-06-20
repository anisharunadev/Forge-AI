#!/usr/bin/env node
// CLI entry point: apply the FORA multi-tenant migration set against a
// Postgres database. Connects with the migration role (BYPASSRLS), runs
// the BYPASSRLS audit, applies each migration in a transaction, and
// reports the result.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist', 'index.js');
const mod = await import(dist);

const url = process.env.FORA_DATABASE_URL;
if (!url) {
  console.error('FORA_DATABASE_URL is not set. Refusing to run.');
  process.exit(2);
}
const projectRoot = process.env.FORA_PROJECT_ROOT ?? join(here, '..', '..', '..');

const pool = new pg.Pool({ connectionString: url });
try {
  const result = await mod.runMigrations(pool, { projectRoot });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
} finally {
  await pool.end();
}
