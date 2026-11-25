import { CONTRACT_TYPES, type SavedSearch, type SourceId } from '../../shared/types.js';
import { db } from '../db.js';
import { HttpError, str } from '../http.js';

type Row = Record<string, any>;
const ALL_SOURCES: SourceId[] = ['france_travail', 'adzuna', 'jooble', 'lba', 'remotive'];

export function mapSearch(r: Row): SavedSearch {
  return {
    id: r.id,
    name: r.name,
    keywords: r.keywords,
    location: r.location ?? null,
    radiusKm: r.radius_km,
    contracts: r.contracts ?? [],
    remote: r.remote,
    salaryMin: r.salary_min ?? null,
    salaryMax: r.salary_max ?? null,
    publishedSinceDays: r.published_since_days,
    sources: r.sources ?? [],
    romeCodes: r.rome_codes ?? [],
    excludeKeywords: r.exclude_keywords ?? [],
    minScore: r.min_score,
    alert: r.alert,
    lastRunAt: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
    lastNewCount: r.last_new_count ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export function sanitizeSearch(input: Partial<SavedSearch>): Omit<SavedSearch, 'id' | 'createdAt' | 'lastRunAt' | 'lastNewCount'> {
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 30) : []);
  const loc = input.location && input.location.label ? input.location : null;
  return {
    name: str(input.name, 120).trim() || str(input.keywords, 80).trim() || 'Recherche',
    keywords: str(input.keywords, 200).trim(),
    location: loc
      ? {
          label: str(loc.label, 120),
          insee: loc.insee ? str(loc.insee, 10) : undefined,
          dept: loc.dept ? str(loc.dept, 4) : undefined,
          lat: Number.isFinite(Number(loc.lat)) ? Number(loc.lat) : undefined,
          lon: Number.isFinite(Number(loc.lon)) ? Number(loc.lon) : undefined,
        }
      : null,
    radiusKm: Math.min(200, Math.max(0, Number(input.radiusKm ?? 30) || 0)),
    contracts: arr(input.contracts).filter((c) => (CONTRACT_TYPES as string[]).includes(c)) as SavedSearch['contracts'],
    remote: input.remote === 'full' || input.remote === 'hybrid' ? input.remote : 'any',
    salaryMin: input.salaryMin ? Math.max(0, Math.round(Number(input.salaryMin))) : null,
    salaryMax: input.salaryMax ? Math.max(0, Math.round(Number(input.salaryMax))) : null,
    publishedSinceDays: [1, 3, 7, 14, 31].includes(Number(input.publishedSinceDays)) ? Number(input.publishedSinceDays) : 7,
    sources: (arr(input.sources).filter((s) => (ALL_SOURCES as string[]).includes(s)) as SourceId[]).concat(),
    romeCodes: arr(input.romeCodes).map((c) => c.toUpperCase()).filter((c) => /^[A-N]\d{4}$/.test(c)),
    excludeKeywords: arr(input.excludeKeywords),
    minScore: Math.min(100, Math.max(0, Number(input.minScore ?? 60) || 0)),
    alert: input.alert !== false,
  };
}

export async function listSearches(): Promise<SavedSearch[]> {
  const d = await db();
  return (await d.query('select * from searches order by created_at desc')).map(mapSearch);
}

export async function getSearch(id: number): Promise<SavedSearch> {
  const d = await db();
  const [r] = await d.query('select * from searches where id = $1', [id]);
  if (!r) throw new HttpError(404, 'Recherche introuvable');
  return mapSearch(r);
}

export async function createSearch(input: Partial<SavedSearch>): Promise<SavedSearch> {
  const s = sanitizeSearch(input);
  if (!s.keywords && !s.romeCodes.length) throw new HttpError(400, 'Mots-clés ou codes ROME requis');
  // Keep range coherent: if both set and inverted, swap.
  if (s.salaryMin != null && s.salaryMax != null && s.salaryMin > s.salaryMax) {
    const tmp = s.salaryMin;
    s.salaryMin = s.salaryMax;
    s.salaryMax = tmp;
  }
  const d = await db();
  const [r] = await d.query(
    `insert into searches (name, keywords, location, radius_km, contracts, remote, salary_min, salary_max, published_since_days, sources, rome_codes, exclude_keywords, min_score, alert)
     values ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
    [s.name, s.keywords, s.location ? JSON.stringify(s.location) : null, s.radiusKm, s.contracts, s.remote, s.salaryMin, s.salaryMax, s.publishedSinceDays, s.sources, s.romeCodes, s.excludeKeywords, s.minScore, s.alert],
  );
  return mapSearch(r);
}

export async function updateSearch(id: number, input: Partial<SavedSearch>): Promise<SavedSearch> {
  const current = await getSearch(id);
  const s = sanitizeSearch({ ...current, ...input });
  if (s.salaryMin != null && s.salaryMax != null && s.salaryMin > s.salaryMax) {
    const tmp = s.salaryMin;
    s.salaryMin = s.salaryMax;
    s.salaryMax = tmp;
  }
  const d = await db();
  const [r] = await d.query(
    `update searches set name=$1, keywords=$2, location=$3::jsonb, radius_km=$4, contracts=$5, remote=$6, salary_min=$7, salary_max=$8, published_since_days=$9, sources=$10, rome_codes=$11, exclude_keywords=$12, min_score=$13, alert=$14 where id=$15 returning *`,
    [s.name, s.keywords, s.location ? JSON.stringify(s.location) : null, s.radiusKm, s.contracts, s.remote, s.salaryMin, s.salaryMax, s.publishedSinceDays, s.sources, s.romeCodes, s.excludeKeywords, s.minScore, s.alert, id],
  );
  return mapSearch(r);
}

export async function deleteSearch(id: number): Promise<void> {
  const d = await db();
  await d.query('delete from searches where id = $1', [id]);
}

export async function markSearchRun(id: number, newCount: number): Promise<void> {
  const d = await db();
  await d.query('update searches set last_run_at = now(), last_new_count = $1 where id = $2', [newCount, id]);
}
