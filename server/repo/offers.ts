import { normalize, scoreOffer, truncate } from '../../shared/analysis/index.js';
import type { NormalizedOffer, Offer, Profile } from '../../shared/types.js';
import { db } from '../db.js';
import { HttpError } from '../http.js';

type Row = Record<string, any>;
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export function mapOffer(r: Row, full = false): Offer {
  return {
    id: r.id,
    source: r.source,
    sourceId: r.source_id,
    url: r.url,
    title: r.title,
    company: r.company,
    location: r.location,
    lat: r.lat ?? null,
    lon: r.lon ?? null,
    contract: r.contract ?? null,
    remote: r.remote ?? null,
    salaryMin: r.salary_min ?? null,
    salaryMax: r.salary_max ?? null,
    salaryText: r.salary_text,
    description: full ? r.description : truncate(r.description ?? '', 420),
    publishedAt: iso(r.published_at),
    fetchedAt: iso(r.fetched_at)!,
    status: r.status,
    matchScore: r.match_score ?? null,
    searchId: r.search_id ?? null,
    applicationId: r.application_id ?? null,
    ...(full ? { analysis: r.analysis ?? null, match: r.match ?? null } : {}),
  };
}

export function dedupeKey(title: string, company: string): string {
  const t = normalize(title)
    .replace(/\((h|f|h\/f|f\/h|m\/f|x)[^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const c = normalize(company).replace(/\b(sas|sa|sarl|sasu|group|groupe|france)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return `${t}|${c}`.slice(0, 300);
}

export interface UpsertResult {
  inserted: Offer[];
  updated: number;
  duplicates: number;
}

/** Store connector results: new offers are analyzed + scored; known ones are refreshed. */
export async function upsertOffers(list: NormalizedOffer[], profile: Profile, opts: { searchId?: number | null } = {}): Promise<UpsertResult> {
  const d = await db();
  const res: UpsertResult = { inserted: [], updated: 0, duplicates: 0 };
  const valid = list.filter((o) => o.title && o.sourceId);
  if (!valid.length) return res;
  // Two round-trips to know what is already stored (Neon HTTP: keep queries few).
  const keys = valid.map((o) => `${o.source}:${o.sourceId}`);
  const known = await d.query<{ id: number; k: string }>(`select id, source || ':' || source_id as k from offers where source || ':' || source_id = any($1)`, [keys]);
  const knownMap = new Map(known.map((r) => [r.k, r.id]));
  const dkeys = valid.map((o) => dedupeKey(o.title, o.company));
  const dups = new Set(
    (await d.query<{ dedupe_key: string }>(`select dedupe_key from offers where dedupe_key = any($1) and fetched_at > now() - interval '45 days'`, [dkeys])).map((r) => r.dedupe_key),
  );
  if (knownMap.size) {
    await d.query('update offers set fetched_at = now() where id = any($1)', [[...knownMap.values()]]);
    res.updated = knownMap.size;
  }
  const seen = new Set<string>();
  for (let i = 0; i < valid.length; i++) {
    const o = valid[i];
    const key = dkeys[i];
    if (knownMap.has(keys[i])) continue;
    if (dups.has(key) || seen.has(key)) {
      res.duplicates++;
      continue;
    }
    seen.add(key);
    const { analysis, match } = scoreOffer(o, profile);
    const [row] = await d.query(
      `insert into offers (source, source_id, dedupe_key, url, title, company, location, lat, lon, contract, remote, salary_min, salary_max, salary_text, description, published_at, match_score, analysis, match, search_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20)
       on conflict (source, source_id) do nothing returning *`,
      [
        o.source,
        o.sourceId,
        key,
        o.url ?? '',
        o.title.slice(0, 300),
        (o.company || analysis.company || '').slice(0, 200),
        (o.location || analysis.location || '').slice(0, 200),
        o.lat ?? null,
        o.lon ?? null,
        o.contract ?? analysis.contract ?? null,
        o.remote ?? analysis.remote ?? null,
        o.salaryMin ?? analysis.salary?.annualMin ?? null,
        o.salaryMax ?? analysis.salary?.annualMax ?? null,
        o.salaryText || analysis.salary?.text || '',
        (o.description ?? '').slice(0, 60000),
        o.publishedAt ? new Date(o.publishedAt) : null,
        match.score,
        JSON.stringify(analysis),
        JSON.stringify(match),
        opts.searchId ?? null,
      ],
    );
    if (row) res.inserted.push(mapOffer(row));
  }
  return res;
}

/** Store one offer (live search result or import) and return its row id. */
export async function saveOffer(o: NormalizedOffer, profile: Profile, status: Offer['status'] = 'saved'): Promise<number> {
  await upsertOffers([o], profile);
  const d = await db();
  const [row] = await d.query<{ id: number }>('select id from offers where source = $1 and source_id = $2', [o.source, o.sourceId]);
  if (!row) {
    // Same ad already stored from another source: reuse it.
    const [dup] = await d.query<{ id: number }>('select id from offers where dedupe_key = $1 order by fetched_at desc limit 1', [dedupeKey(o.title, o.company)]);
    if (!dup) throw new HttpError(500, 'Enregistrement de l’offre impossible');
    await d.query(`update offers set status = $1 where id = $2 and status in ('new','seen','dismissed')`, [status, dup.id]);
    return dup.id;
  }
  await d.query(`update offers set status = $1 where id = $2 and status in ('new','seen','dismissed')`, [status, row.id]);
  return row.id;
}

export interface OfferFilters {
  status?: string;
  source?: string;
  q?: string;
  minScore?: number;
  contract?: string;
  remote?: string;
  searchId?: number;
  sinceDays?: number;
  sort?: 'score' | 'date';
  limit?: number;
  offset?: number;
}

export async function listOffers(f: OfferFilters): Promise<{ items: Offer[]; total: number }> {
  const d = await db();
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown): void => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.status === 'inbox') where.push(`o.status in ('new','seen')`);
  else if (f.status && f.status !== 'all') add('o.status = any(?)', f.status.split(','));
  if (f.source) add('o.source = any(?)', f.source.split(','));
  if (f.q) {
    params.push(`%${f.q.toLowerCase()}%`);
    const p = `$${params.length}`;
    where.push(`(lower(o.title) like ${p} or lower(o.company) like ${p} or lower(o.location) like ${p} or lower(o.description) like ${p})`);
  }
  if (f.minScore) add('coalesce(o.match_score, 0) >= ?', f.minScore);
  if (f.contract) add('o.contract = any(?)', f.contract.split(','));
  if (f.remote === 'full') where.push(`o.remote = 'full'`);
  else if (f.remote === 'hybrid') where.push(`o.remote in ('full','hybrid')`);
  if (f.searchId) add('o.search_id = ?', f.searchId);
  if (f.sinceDays) add(`coalesce(o.published_at, o.fetched_at) > now() - (? || ' days')::interval`, String(f.sinceDays));
  const w = where.length ? `where ${where.join(' and ')}` : '';
  const order = f.sort === 'date' ? 'coalesce(o.published_at, o.fetched_at) desc' : 'o.match_score desc nulls last, coalesce(o.published_at, o.fetched_at) desc';
  const [{ total }] = await d.query<{ total: number }>(`select count(*)::int as total from offers o ${w}`, params);
  const rows = await d.query(
    `select o.*, (select a.id from applications a where a.offer_id = o.id limit 1) as application_id from offers o ${w} order by ${order} limit ${Math.min(f.limit ?? 30, 100)} offset ${Math.max(0, f.offset ?? 0)}`,
    params,
  );
  return { items: rows.map((r) => mapOffer(r)), total };
}

export async function getOffer(id: number, profile: Profile): Promise<Offer> {
  const d = await db();
  const [row] = await d.query('select o.*, (select a.id from applications a where a.offer_id = o.id limit 1) as application_id from offers o where id = $1', [id]);
  if (!row) throw new HttpError(404, 'Offre introuvable');
  // Re-score with the current profile (it may have changed since the import).
  const { analysis, match } = scoreOffer(
    { title: row.title, description: row.description, company: row.company, location: row.location, contract: row.contract, remote: row.remote, salaryText: row.salary_text, salaryMin: row.salary_min, salaryMax: row.salary_max, lat: row.lat, lon: row.lon },
    profile,
  );
  if (match.score !== row.match_score) {
    await d.query('update offers set match_score = $1, match = $2::jsonb, analysis = $3::jsonb where id = $4', [match.score, JSON.stringify(match), JSON.stringify(analysis), id]);
  }
  if (row.status === 'new') await d.query(`update offers set status = 'seen' where id = $1`, [id]);
  return { ...mapOffer({ ...row, match_score: match.score, status: row.status === 'new' ? 'seen' : row.status }, true), analysis, match };
}

export async function setOfferStatus(id: number, status: Offer['status']): Promise<void> {
  if (!['new', 'seen', 'saved', 'dismissed', 'applied'].includes(status)) throw new HttpError(400, 'Statut invalide');
  const d = await db();
  await d.query('update offers set status = $1 where id = $2', [status, id]);
}

export async function bulkOfferStatus(ids: number[], status: Offer['status']): Promise<void> {
  const d = await db();
  await d.query('update offers set status = $1 where id = any($2)', [status, ids]);
}

/** Recompute every stored score after a profile change (batched updates). */
export async function rescoreAll(profile: Profile): Promise<number> {
  const d = await db();
  const rows = await d.query(`select id, title, description, company, location, contract, remote, salary_text, salary_min, salary_max, lat, lon from offers where status <> 'dismissed' order by fetched_at desc limit 2000`);
  for (let i = 0; i < rows.length; i += 250) {
    const chunk = rows.slice(i, i + 250).map((r) => {
      const { analysis, match } = scoreOffer(
        { title: r.title, description: r.description, company: r.company, location: r.location, contract: r.contract, remote: r.remote, salaryText: r.salary_text, salaryMin: r.salary_min, salaryMax: r.salary_max, lat: r.lat, lon: r.lon },
        profile,
      );
      return { id: r.id as number, score: match.score, match: JSON.stringify(match), analysis: JSON.stringify(analysis) };
    });
    await d.query(
      `update offers o set match_score = v.score, match = v.match::jsonb, analysis = v.analysis::jsonb
       from (select unnest($1::int[]) as id, unnest($2::int[]) as score, unnest($3::text[]) as match, unnest($4::text[]) as analysis) v
       where o.id = v.id`,
      [chunk.map((c) => c.id), chunk.map((c) => c.score), chunk.map((c) => c.match), chunk.map((c) => c.analysis)],
    );
  }
  return rows.length;
}

/** Tell the UI which live-search results are already stored. */
export async function annotateKnown(list: NormalizedOffer[]): Promise<NormalizedOffer[]> {
  if (!list.length) return list;
  const d = await db();
  const rows = await d.query<{ id: number; source: string; source_id: string; status: Offer['status'] }>(
    `select id, source, source_id, status from offers where source || ':' || source_id = any($1)`,
    [list.map((o) => `${o.source}:${o.sourceId}`)],
  );
  const map = new Map(rows.map((r) => [`${r.source}:${r.source_id}`, r]));
  return list.map((o) => {
    const k = map.get(`${o.source}:${o.sourceId}`);
    return k ? { ...o, storedId: k.id, storedStatus: k.status } : o;
  });
}

export async function deleteOldOffers(days = 120): Promise<number> {
  const d = await db();
  const rows = await d.query(`delete from offers where status in ('new','seen','dismissed') and fetched_at < now() - ($1 || ' days')::interval and id not in (select offer_id from applications where offer_id is not null) returning id`, [String(days)]);
  return rows.length;
}
