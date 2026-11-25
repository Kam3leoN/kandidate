/**
 * Aggregators with a free official API key: Adzuna, Jooble.
 * Remotive (no key, remote jobs) and La bonne alternance (gov, token) live here too.
 */
import { htmlToText, normalize } from '../../shared/analysis/text.js';
import type { ContractType, NormalizedOffer, RemoteMode } from '../../shared/types.js';
import { fetchJson, isoDaysAgo, keywordTerms, SourceError, type Connector, type SearchQuery } from './common.js';

/* ───────────── Adzuna — https://developer.adzuna.com/docs/search ───────────── */

interface AdzunaJob {
  id: string;
  title: string;
  description: string;
  created: string;
  redirect_url: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  latitude?: number;
  longitude?: number;
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string | number;
  contract_type?: 'permanent' | 'contract';
  contract_time?: 'full_time' | 'part_time';
}

export const adzuna: Connector = {
  id: 'adzuna',
  label: 'Adzuna',
  needs: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
  note: 'Agrégateur (Indeed, Monster, sites carrière…) — clé gratuite sur developer.adzuna.com. Descriptions tronquées.',
  configured: () => !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
  async search(q: SearchQuery): Promise<NormalizedOffer[]> {
    const p = new URLSearchParams({
      app_id: process.env.ADZUNA_APP_ID ?? '',
      app_key: process.env.ADZUNA_APP_KEY ?? '',
      results_per_page: String(Math.min(50, q.limit ?? 40)),
      sort_by: 'date',
      max_days_old: String(q.publishedSinceDays ?? 7),
      'content-type': 'application/json',
    });
    if (q.keywords) p.set('what', q.keywords);
    if (q.excludeKeywords?.length) p.set('what_exclude', q.excludeKeywords.join(' '));
    if (q.location?.label) {
      p.set('where', q.location.label.replace(/\s*\(.*\)$/, ''));
      p.set('distance', String(q.radiusKm ?? 30));
    }
    if (q.salaryMin) p.set('salary_min', String(q.salaryMin));
    const c = q.contracts ?? [];
    if (c.length === 1 && c[0] === 'CDI') p.set('permanent', '1');
    else if (c.length && c.every((x) => x === 'CDD' || x === 'Freelance' || x === 'Intérim')) p.set('contract', '1');
    const { data } = await fetchJson<{ results?: AdzunaJob[] }>('adzuna', `https://api.adzuna.com/v1/api/jobs/fr/search/1?${p}`);
    return (data?.results ?? []).map((j) => {
      const predicted = String(j.salary_is_predicted ?? '0') === '1';
      const contract: ContractType | null = j.contract_type === 'permanent' ? 'CDI' : null;
      return {
        source: 'adzuna',
        sourceId: String(j.id),
        url: j.redirect_url,
        title: htmlToText(j.title),
        company: j.company?.display_name ?? '',
        location: j.location?.display_name ?? '',
        lat: j.latitude ?? null,
        lon: j.longitude ?? null,
        contract,
        remote: null,
        salaryMin: predicted ? null : (j.salary_min ?? null),
        salaryMax: predicted ? null : (j.salary_max ?? null),
        salaryText:
          j.salary_min && !predicted
            ? `${Math.round(j.salary_min / 1000)}${j.salary_max && j.salary_max !== j.salary_min ? `–${Math.round(j.salary_max / 1000)}` : ''} k€ / an`
            : '',
        description: htmlToText(j.description),
        publishedAt: j.created,
      };
    });
  },
};

/* ───────────── Jooble — https://jooble.org/api/about ───────────── */

interface JoobleJob {
  id: number | string;
  title: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  link: string;
  company?: string;
  updated?: string;
}

const JOOBLE_RADII = [0, 4, 8, 16, 26, 40, 80];

export const jooble: Connector = {
  id: 'jooble',
  label: 'Jooble',
  needs: ['JOOBLE_API_KEY'],
  note: 'Agrégateur multi-sites — clé gratuite sur jooble.org/api/about. Quota de requêtes limité par clé : utilisé surtout par la veille quotidienne.',
  configured: () => !!process.env.JOOBLE_API_KEY,
  async search(q: SearchQuery): Promise<NormalizedOffer[]> {
    const endpoint = (process.env.JOOBLE_ENDPOINT || 'https://fr.jooble.org/api/').replace(/\/?$/, '/');
    const radius = JOOBLE_RADII.find((r) => r >= (q.radiusKm ?? 26)) ?? 80;
    const body: Record<string, unknown> = {
      keywords: q.keywords,
      location: q.location?.label?.replace(/\s*\(.*\)$/, '') ?? '',
      radius: String(radius),
      page: '1',
      ResultOnPage: String(Math.min(50, q.limit ?? 30)),
      datecreatedfrom: isoDaysAgo(q.publishedSinceDays ?? 7).slice(0, 10),
    };
    if (q.salaryMin) body.salary = q.salaryMin;
    const { data } = await fetchJson<{ jobs?: JoobleJob[] }>('jooble', `${endpoint}${process.env.JOOBLE_API_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (data?.jobs ?? []).map((j) => {
      const t = normalize(j.type ?? '');
      const contract: ContractType | null = /cdi|permanent|temps plein/.test(t)
        ? 'CDI'
        : /cdd|temporaire/.test(t)
          ? 'CDD'
          : /freelance|independant/.test(t)
            ? 'Freelance'
            : /interim/.test(t)
              ? 'Intérim'
              : /stage|intern/.test(t)
                ? 'Stage'
                : /alternance|apprenti/.test(t)
                  ? 'Alternance'
                  : null;
      return {
        source: 'jooble',
        sourceId: String(j.id),
        url: j.link,
        title: htmlToText(j.title),
        company: j.company ?? '',
        location: j.location ?? '',
        contract,
        remote: null,
        salaryText: j.salary ?? '',
        description: htmlToText(j.snippet ?? '') + (j.source ? `\n\nSource : ${j.source}` : ''),
        publishedAt: j.updated ?? null,
      };
    });
  },
};

/* ───────────── Remotive — https://remotive.com/api/remote-jobs ───────────── */

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

const REMOTIVE_OK = /(france|europe|emea|worldwide|anywhere|cet|cest|utc[+-]?[0-3]?\b|^$)/i;

export const remotive: Connector = {
  id: 'remotive',
  label: 'Remotive',
  needs: [],
  note: 'Offres 100 % télétravail (sans clé). Lien vers Remotive conservé, comme le demandent leurs conditions. Données en différé de 24 h.',
  configured: () => process.env.REMOTIVE_DISABLED !== '1',
  async search(q: SearchQuery): Promise<NormalizedOffer[]> {
    const p = new URLSearchParams({ limit: String(Math.min(100, (q.limit ?? 40) * 2)) });
    if (q.keywords) p.set('search', q.keywords);
    const { data } = await fetchJson<{ jobs?: RemotiveJob[] }>('remotive', `https://remotive.com/api/remote-jobs?${p}`);
    const since = Date.now() - (q.publishedSinceDays ?? 7) * 86400_000 - 86400_000;
    return (data?.jobs ?? [])
      .filter((j) => REMOTIVE_OK.test((j.candidate_required_location ?? '').trim()))
      .filter((j) => !j.publication_date || new Date(j.publication_date).getTime() >= since)
      .slice(0, q.limit ?? 40)
      .map((j) => {
        const t = j.job_type ?? '';
        const contract: ContractType | null = /freelance|contract/.test(t) ? 'Freelance' : /intern/.test(t) ? 'Stage' : null;
        return {
          source: 'remotive',
          sourceId: String(j.id),
          url: j.url,
          title: j.title,
          company: j.company_name,
          location: j.candidate_required_location || 'Télétravail',
          contract,
          remote: 'full' as RemoteMode,
          salaryText: j.salary ?? '',
          description: `${htmlToText(j.description ?? '')}${j.tags?.length ? `\n\nTags : ${j.tags.join(', ')}` : ''}\n\nOffre publiée sur Remotive.`,
          publishedAt: j.publication_date ?? null,
        };
      });
  },
};

/* ───────────── La bonne alternance — API apprentissage (api.apprentissage.beta.gouv.fr) ───────────── */

interface LbaJob {
  identifier?: { id?: string; partner_label?: string; partner_job_id?: string };
  workplace?: {
    name?: string | null;
    brand?: string | null;
    legal_name?: string | null;
    location?: { address?: string | null; geopoint?: { coordinates?: [number, number] } | null } | null;
  };
  apply?: { url?: string | null };
  contract?: { type?: string[] | null; remote?: string | null; duration?: number | null; start?: string | null };
  offer?: {
    title?: string;
    description?: string;
    desired_skills?: string[] | null;
    to_be_acquired_skills?: string[] | null;
    target_diploma?: { label?: string | null } | null;
    publication?: { creation?: string | null };
  };
}

export const lba: Connector = {
  id: 'lba',
  label: 'La bonne alternance',
  needs: ['LBA_API_TOKEN'],
  note: 'Offres en alternance (service public) — jeton gratuit sur api.apprentissage.beta.gouv.fr. Recherche par lieu et/ou codes ROME.',
  configured: () => !!process.env.LBA_API_TOKEN,
  async search(q: SearchQuery): Promise<NormalizedOffer[]> {
    const url = process.env.LBA_API_URL || 'https://api.apprentissage.beta.gouv.fr/api/job/v1/search';
    const p = new URLSearchParams();
    if (q.location?.lat != null && q.location?.lon != null) {
      p.set('latitude', String(q.location.lat));
      p.set('longitude', String(q.location.lon));
      p.set('radius', String(Math.min(200, q.radiusKm ?? 30)));
    }
    if (q.romeCodes?.length) p.set('romes', q.romeCodes.join(','));
    if (!p.has('latitude') && !p.has('romes')) throw new SourceError('lba', 'Précise un lieu ou des codes ROME pour La bonne alternance');
    const { data } = await fetchJson<{ jobs?: LbaJob[] }>('lba', `${url}?${p}`, {
      headers: { authorization: `Bearer ${process.env.LBA_API_TOKEN}` },
    });
    const terms = keywordTerms(q.keywords).map((t) => normalize(t));
    return (data?.jobs ?? [])
      .filter((j) => {
        if (!terms.length) return true;
        const hay = normalize(`${j.offer?.title ?? ''} ${j.offer?.description ?? ''}`);
        return terms.some((t) => hay.includes(t));
      })
      .slice(0, q.limit ?? 40)
      .map((j) => {
        const coords = j.workplace?.location?.geopoint?.coordinates;
        const remote = j.contract?.remote === 'remote' ? 'full' : j.contract?.remote === 'hybrid' ? 'hybrid' : j.contract?.remote === 'onsite' ? 'onsite' : null;
        const skills = [...(j.offer?.desired_skills ?? []), ...(j.offer?.to_be_acquired_skills ?? [])];
        return {
          source: 'lba',
          sourceId: j.identifier?.id ?? j.identifier?.partner_job_id ?? `${j.offer?.title}-${j.workplace?.name}`,
          url: j.apply?.url || 'https://labonnealternance.apprentissage.beta.gouv.fr/',
          title: j.offer?.title ?? 'Offre en alternance',
          company: j.workplace?.brand || j.workplace?.name || j.workplace?.legal_name || '',
          location: j.workplace?.location?.address ?? '',
          lat: coords ? coords[1] : null,
          lon: coords ? coords[0] : null,
          contract: 'Alternance' as ContractType,
          remote: remote as RemoteMode | null,
          salaryText: '',
          description: [
            j.offer?.description ?? '',
            skills.length ? `Compétences :\n${skills.map((s) => `• ${s}`).join('\n')}` : '',
            j.offer?.target_diploma?.label ? `Diplôme visé : ${j.offer.target_diploma.label}` : '',
            j.contract?.duration ? `Durée du contrat : ${j.contract.duration} mois` : '',
            j.identifier?.partner_label ? `Source : ${j.identifier.partner_label}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
          publishedAt: j.offer?.publication?.creation ?? null,
        };
      });
  },
};
