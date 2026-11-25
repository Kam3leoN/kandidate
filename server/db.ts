/**
 * Database access.
 * - Production (Vercel): Neon serverless driver over HTTP (`DATABASE_URL`).
 * - Local dev without DATABASE_URL: embedded PGlite (Postgres in WASM) in `.data/pglite`.
 */
import { MIGRATIONS } from './migrations.js';

export interface Db {
  kind: 'neon' | 'pglite';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = Record<string, any>>(text: string, params?: unknown[]): Promise<T[]>;
}

let dbPromise: Promise<Db> | null = null;
let schemaPromise: Promise<void> | null = null;

async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    return {
      kind: 'neon',
      query: async <T>(text: string, params: unknown[] = []) => (await sql.query(text, params)) as T[],
    };
  }
  // Module name built at runtime so the serverless bundler never ships PGlite.
  const mod = ['@electric-sql', 'pglite'].join('/');
  const { PGlite } = (await import(/* @vite-ignore */ mod)) as typeof import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR ?? '.data/pglite';
  if (dir !== 'memory') {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
  }
  const pg = new PGlite(dir === 'memory' ? undefined : dir);
  await pg.waitReady;
  console.info(`[kandidate] DATABASE_URL absent → base locale PGlite (${dir})`);
  return {
    kind: 'pglite',
    query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows,
  };
}

export function getDb(): Promise<Db> {
  dbPromise ??= createDb().catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

/** Apply pending migrations once per instance (idempotent, cheap when up to date). */
export async function ensureSchema(): Promise<void> {
  schemaPromise ??= (async () => {
    const db = await getDb();
    await db.query(`create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now())`);
    const rows = await db.query<{ version: number }>('select version from schema_migrations');
    const done = new Set(rows.map((r) => Number(r.version)));
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      for (const stmt of m.statements) await db.query(stmt);
      await db.query('insert into schema_migrations (version) values ($1) on conflict do nothing', [m.version]);
      console.info(`[kandidate] migration ${m.version} (${m.name}) appliquée`);
    }
  })().catch((e) => {
    schemaPromise = null;
    throw e;
  });
  return schemaPromise;
}

export async function db(): Promise<Db> {
  await ensureSchema();
  return getDb();
}
