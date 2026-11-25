import { normalize, scoreOffer } from '../../shared/analysis/index.js';
import type { GeoPoint, NormalizedOffer, Profile, SourceId, SourceStatus } from '../../shared/types.js';
import { dedupeKey } from '../repo/offers.js';
import { adzuna, jooble, lba, remotive } from './aggregators.js';
import { fetchJson, SourceError, type Connector, type SearchQuery } from './common.js';
import { franceTravail } from './france-travail.js';

export type { SearchQuery } from './common.js';

export const CONNECTORS: Connector[] = [franceTravail, adzuna, jooble, lba, remotive];

export function sourceStatuses(): SourceStatus[] {
  const list: SourceStatus[] = CONNECTORS.map((c) => ({ id: c.id, label: c.label, configured: c.configured(), needs: c.needs, note: c.note }));
  list.push({
    id: 'email',
    label: 'Alertes email (LinkedIn, Cadremploi, APEC, WTTJ…)',
    configured: !!(process.env.RESEND_API_KEY && process.env.RESEND_WEBHOOK_SECRET) || !!process.env.INBOUND_TOKEN,
    needs: ['RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'ou INBOUND_TOKEN'],
    note: 'Transfère tes alertes email vers ton adresse de réception Resend : les offres sont extraites et ajoutées à ta veille.',
  });
  list.push({ id: 'import', label: 'Import d’annonce (URL ou texte)', configured: true, needs: [], note: 'Colle une URL ou le texte d’une annonce depuis n’importe quel site.' });
  return list;
}

export interface RunResult {
  offers: Array<NormalizedOffer & { matchScore: number }>;
  errors: Array<{ source: SourceId; message: string }>;
  counts: Partial<Record<SourceId, number>>;
}

/** Query every selected + configured source in parallel, dedupe, score and filter. */
export async function runSearch(q: SearchQuery, sources: SourceId[] | undefined, profile: Profile): Promise<RunResult> {
  const wanted = CONNECTORS.filter((c) => (!sources?.length || sources.includes(c.id)) && c.configured());
  // La bonne alternance only makes sense for apprenticeship searches.
  const active = wanted.filter((c) => c.id !== 'lba' || !q.contracts?.length || q.contracts.includes('Alternance') || sources?.includes('lba'));
  const errors: RunResult['errors'] = [];
  const counts: RunResult['counts'] = {};
  const settled = await Promise.allSettled(active.map((c) => c.search(q)));
  const all: NormalizedOffer[] = [];
  settled.forEach((r, i) => {
    const id = active[i].id;
    if (r.status === 'fulfilled') {
      counts[id] = r.value.length;
      all.push(...r.value);
    } else {
      const e = r.reason;
      errors.push({ source: id, message: e instanceof SourceError || e instanceof Error ? e.message : String(e) });
      console.warn(`[sources] ${id}:`, e);
    }
  });
  const seen = new Set<string>();
  const excluded = (q.excludeKeywords ?? []).map((k) => normalize(k)).filter(Boolean);
  const out: RunResult['offers'] = [];
  for (const o of all) {
    const key = dedupeKey(o.title, o.company);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = normalize(`${o.title} ${o.company}`);
    if (excluded.some((k) => title.includes(k))) continue;
    const { analysis, match } = scoreOffer(o, profile);
    const remote = o.remote ?? analysis.remote;
    if (q.remote === 'full' && remote !== 'full') continue;
    if (q.remote === 'hybrid' && remote !== 'full' && remote !== 'hybrid') continue;
    out.push({ ...o, contract: o.contract ?? analysis.contract, remote, matchScore: match.score, match });
  }
  out.sort((a, b) => b.matchScore - a.matchScore);
  return { offers: out, errors, counts };
}

/* ───────────── Geo (geo.api.gouv.fr — no key) ───────────── */

interface GeoCommune {
  nom: string;
  code: string;
  codeDepartement?: string;
  codesPostaux?: string[];
  centre?: { coordinates: [number, number] };
  population?: number;
}

export async function searchCommunes(text: string): Promise<GeoPoint[]> {
  const t = text.trim();
  if (t.length < 2) return [];
  const p = new URLSearchParams({ fields: 'nom,code,codeDepartement,codesPostaux,centre,population', boost: 'population', limit: '8' });
  if (/^\d{5}$/.test(t)) p.set('codePostal', t);
  else p.set('nom', t);
  const { data } = await fetchJson<GeoCommune[]>('import', `https://geo.api.gouv.fr/communes?${p}`, {}, 6000);
  const out: GeoPoint[] = (data ?? []).map((c) => ({
    label: `${c.nom} (${c.codeDepartement ?? c.codesPostaux?.[0]?.slice(0, 2) ?? ''})`,
    insee: c.code,
    dept: c.codeDepartement,
    lat: c.centre?.coordinates[1],
    lon: c.centre?.coordinates[0],
  }));
  // Departments by number ("69", "2A").
  if (/^(\d{2,3}|2a|2b)$/i.test(t)) {
    const { data: deps } = await fetchJson<Array<{ nom: string; code: string }>>('import', `https://geo.api.gouv.fr/departements/${t.toUpperCase()}`, {}, 6000).catch(() => ({ data: null }));
    const dep = deps as unknown as { nom: string; code: string } | null;
    if (dep?.code) out.unshift({ label: `${dep.nom} (département ${dep.code})`, dept: dep.code });
  }
  return out;
}
