/** npm run db:migrate — apply the schema to DATABASE_URL (Neon) or the local PGlite. */
import './env.js';
import { ensureSchema, getDb } from '../server/db.js';

await ensureSchema();
const db = await getDb();
const rows = await db.query<{ version: number; applied_at: string }>('select version, applied_at from schema_migrations order by version');
console.log(`✔ Schéma à jour sur ${db.kind} :`, rows.map((r) => `v${r.version}`).join(', '));
process.exit(0);
