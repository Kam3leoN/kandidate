import type { ContractType, GeoPoint, NormalizedOffer, SourceId } from '../../shared/types.js';

export interface SearchQuery {
  keywords: string;
  location?: GeoPoint | null;
  radiusKm?: number;
  contracts?: ContractType[];
  remote?: 'any' | 'hybrid' | 'full';
  salaryMin?: number | null;
  salaryMax?: number | null;
  publishedSinceDays?: number;
  romeCodes?: string[];
  excludeKeywords?: string[];
  limit?: number;
}

export interface Connector {
  id: SourceId;
  label: string;
  /** Env vars this connector needs. */
  needs: string[];
  note: string;
  configured(): boolean;
  search(q: SearchQuery): Promise<NormalizedOffer[]>;
}

export class SourceError extends Error {
  constructor(
    public source: SourceId,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export const USER_AGENT = 'KandiDate/1.0 (suivi de candidatures personnel)';

export async function fetchJson<T>(source: SourceId, url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<{ status: number; data: T | null; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new SourceError(source, e instanceof Error && e.name === 'TimeoutError' ? 'Délai dépassé' : `Réseau : ${(e as Error).message}`);
  }
  if (res.status === 204) return { status: 204, data: null, headers: res.headers };
  const text = await res.text();
  if (!res.ok && res.status !== 206) {
    let msg = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      msg = j.message ?? j.error_description ?? j.error ?? j.exception ?? msg;
    } catch {
      /* keep raw */
    }
    throw new SourceError(source, `HTTP ${res.status} — ${msg}`, res.status);
  }
  try {
    return { status: res.status, data: text ? (JSON.parse(text) as T) : null, headers: res.headers };
  } catch {
    throw new SourceError(source, 'Réponse non JSON');
  }
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

/** French / job-ad stopwords — never required for AND matching. */
const KEYWORD_STOP = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'et', 'en', 'au', 'aux', 'ou', 'd', 'l',
  'a', 'à', 'pour', 'avec', 'sur', 'dans', 'par', 'h', 'f', 'hf', 'cdi', 'cdd',
]);

/**
 * Significant search terms.
 * - Comma/semicolon → distinct required groups (kept as phrases).
 * - Spaces → tokens, stopwords dropped (so « chef de projet » → chef, projet).
 */
export function keywordTerms(kw: string): string[] {
  const raw = (kw ?? '').trim();
  if (!raw) return [];
  const groups = raw.split(/[,;]+/).map((g) => g.trim()).filter((g) => g.length >= 2);
  if (groups.length > 1) return groups;
  return raw
    .split(/\s+/)
    .map((t) => t.trim().replace(/^[-–—/]+|[-–—/]+$/g, ''))
    .filter((t) => {
      if (t.length < 2) return false;
      const n = t
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      return !KEYWORD_STOP.has(n);
    });
}

/** Haystack match for a term (hyphen / space tolerant). */
export function termInText(hayNorm: string, term: string): boolean {
  const t = term
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .trim();
  if (!t) return false;
  if (hayNorm.includes(t)) return true;
  // « front end » ↔ « frontend » / « front-end »
  const compact = t.replace(/\s+/g, '');
  if (compact.length >= 3 && hayNorm.replace(/[\s\-/]+/g, '').includes(compact)) return true;
  return false;
}

/**
 * Offer must mention the search terms (title weighted).
 * 1–2 terms → all required; longer → ≥60 % of terms, with ≥1 hit in the title when possible.
 */
export function offerMatchesKeywords(o: Pick<NormalizedOffer, 'title' | 'company' | 'description'>, keywords: string): boolean {
  const terms = keywordTerms(keywords);
  if (!terms.length) return true;
  const hay = `${o.title} ${o.company} ${o.description}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_/]+/g, ' ');
  const title = (o.title ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_/]+/g, ' ');
  const hits = terms.filter((t) => termInText(hay, t));
  const need = terms.length <= 2 ? terms.length : Math.ceil(terms.length * 0.6);
  if (hits.length < need) return false;
  // Prefer relevance: if ≥2 terms, at least one must appear in the title (avoids CV-match noise).
  if (terms.length >= 2 && !terms.some((t) => termInText(title, t))) return false;
  return true;
}

/** Higher = better keyword fit (title hits count double). */
export function keywordRelevance(o: Pick<NormalizedOffer, 'title' | 'company' | 'description'>, keywords: string): number {
  const terms = keywordTerms(keywords);
  if (!terms.length) return 0;
  const title = (o.title ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_/]+/g, ' ');
  const hay = `${o.title} ${o.company} ${o.description}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_/]+/g, ' ');
  let score = 0;
  for (const t of terms) {
    if (termInText(title, t)) score += 2;
    else if (termInText(hay, t)) score += 1;
  }
  return score;
}

/** Keep offers whose known salary band overlaps the desired range. Unknown salary = keep. */
export function offerMatchesSalary(
  o: Pick<NormalizedOffer, 'salaryMin' | 'salaryMax'>,
  salaryMin?: number | null,
  salaryMax?: number | null,
): boolean {
  const wantMin = salaryMin && salaryMin > 0 ? salaryMin : null;
  const wantMax = salaryMax && salaryMax > 0 ? salaryMax : null;
  if (!wantMin && !wantMax) return true;
  const oMin = o.salaryMin ?? null;
  const oMax = o.salaryMax ?? o.salaryMin ?? null;
  if (oMin == null && oMax == null) return true;
  if (wantMax != null && oMin != null && oMin > wantMax) return false;
  if (wantMin != null && oMax != null && oMax < wantMin) return false;
  return true;
}
