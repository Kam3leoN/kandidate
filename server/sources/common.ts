import type { ContractType, GeoPoint, NormalizedOffer, SourceId } from '../../shared/types.js';

export interface SearchQuery {
  keywords: string;
  location?: GeoPoint | null;
  radiusKm?: number;
  contracts?: ContractType[];
  remote?: 'any' | 'hybrid' | 'full';
  salaryMin?: number | null;
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

/** Keywords as separate terms (minus very short ones). */
export function keywordTerms(kw: string): string[] {
  return kw
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}
