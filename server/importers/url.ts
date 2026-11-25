/**
 * Import one job ad from a URL the user pasted (user-initiated, one page).
 * Most career sites and job boards embed a schema.org `JobPosting` (Google for Jobs):
 * we read it when present, otherwise fall back to the page text.
 * Sites that block automated reads (LinkedIn…) → the UI asks to paste the text.
 */
import { decodeEntities, htmlToText } from '../../shared/analysis/text.js';
import type { ContractType, NormalizedOffer, RemoteMode } from '../../shared/types.js';
import { HttpError } from '../http.js';
import { USER_AGENT } from '../sources/common.js';

const BLOCKED_HOSTS = /(^|\.)linkedin\.com$|(^|\.)indeed\.(com|fr)$|(^|\.)glassdoor\./;

function isPrivateHost(host: string): boolean {
  return (
    /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|\[?::1\]?$|\[?fc|\[?fd)/i.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    !host.includes('.')
  );
}

type Json = Record<string, any>;

function findJobPosting(node: unknown): Json | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findJobPosting(n);
      if (f) return f;
    }
    return null;
  }
  const o = node as Json;
  const t = o['@type'];
  if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) return o;
  if (o['@graph']) return findJobPosting(o['@graph']);
  return null;
}

const EMPLOYMENT: Record<string, ContractType> = {
  FULL_TIME: 'CDI',
  PERMANENT: 'CDI',
  CDI: 'CDI',
  TEMPORARY: 'CDD',
  CDD: 'CDD',
  CONTRACTOR: 'Freelance',
  FREELANCE: 'Freelance',
  INTERN: 'Stage',
  INTERNSHIP: 'Stage',
  APPRENTICESHIP: 'Alternance',
};

function addressText(loc: unknown): string {
  const first = Array.isArray(loc) ? loc[0] : loc;
  const a = (first as Json)?.address ?? first;
  if (!a || typeof a !== 'object') return typeof a === 'string' ? a : '';
  return [a.addressLocality, a.postalCode, a.addressRegion].filter(Boolean).join(' ').trim();
}

function salaryFrom(base: Json | undefined): { min: number | null; max: number | null; text: string } {
  if (!base) return { min: null, max: null, text: '' };
  const v = base.value ?? base;
  const unit = String(v.unitText ?? base.unitText ?? 'YEAR').toUpperCase();
  const f = unit === 'MONTH' ? 12 : unit === 'DAY' ? 218 : unit === 'HOUR' ? 1607 : 1;
  const min = Number(v.minValue ?? v.value);
  const max = Number(v.maxValue ?? v.value);
  return {
    min: Number.isFinite(min) && min > 0 ? Math.round(min * f) : null,
    max: Number.isFinite(max) && max > 0 ? Math.round(max * f) : null,
    text: Number.isFinite(min) && min > 0 ? `${min}${Number.isFinite(max) && max !== min ? `–${max}` : ''} ${base.currency ?? '€'} / ${unit.toLowerCase()}` : '',
  };
}

export async function importFromUrl(raw: string): Promise<NormalizedOffer> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, 'URL invalide');
  }
  if (!/^https?:$/.test(url.protocol) || isPrivateHost(url.hostname)) throw new HttpError(400, 'URL non autorisée');
  if (BLOCKED_HOSTS.test(url.hostname)) {
    throw new HttpError(422, `${url.hostname} n’autorise pas la lecture automatique de ses pages : copie-colle le texte de l’annonce.`, { pasteText: true });
  }
  let res: Response | null = null;
  try {
    // Follow redirects by hand so every hop goes through the same host checks.
    for (let hop = 0; hop < 4; hop++) {
      res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml', 'accept-language': 'fr-FR,fr;q=0.9' },
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) break;
      url = new URL(loc, url);
      if (!/^https?:$/.test(url.protocol) || isPrivateHost(url.hostname)) throw new HttpError(400, 'Redirection non autorisée');
      if (BLOCKED_HOSTS.test(url.hostname)) throw new HttpError(422, `${url.hostname} n’autorise pas la lecture automatique : colle le texte de l’annonce.`, { pasteText: true });
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'Page injoignable : colle plutôt le texte de l’annonce.', { pasteText: true });
  }
  if (!res) throw new HttpError(502, 'Page injoignable');
  if (!res.ok) throw new HttpError(422, `La page a répondu ${res.status} : colle plutôt le texte de l’annonce.`, { pasteText: true });
  const type = res.headers.get('content-type') ?? '';
  if (!/html|text/.test(type)) throw new HttpError(422, 'Ce lien ne pointe pas vers une page web.');
  const html = (await res.text()).slice(0, 2_500_000);

  let posting: Json | null = null;
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      posting = findJobPosting(JSON.parse(m[1].trim()));
    } catch {
      /* some sites ship invalid JSON-LD */
    }
    if (posting) break;
  }

  const meta = (name: string): string => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, 'i');
    return decodeEntities(re.exec(html)?.[1] ?? re2.exec(html)?.[1] ?? '');
  };

  if (posting) {
    const s = salaryFrom(posting.baseSalary);
    const emp = (Array.isArray(posting.employmentType) ? posting.employmentType : [posting.employmentType]).map((e: unknown) => String(e ?? '').toUpperCase());
    const contract = emp.map((e: string) => EMPLOYMENT[e]).find(Boolean) ?? null;
    const remote: RemoteMode | null = /TELECOMMUTE/i.test(String(posting.jobLocationType ?? '')) ? 'full' : null;
    return {
      source: 'import',
      sourceId: url.href.slice(0, 500),
      url: url.href,
      title: htmlToText(String(posting.title ?? meta('og:title'))).slice(0, 300),
      company: String(posting.hiringOrganization?.name ?? meta('og:site_name') ?? '').slice(0, 200),
      location: addressText(posting.jobLocation) || (remote ? 'Télétravail' : ''),
      contract,
      remote,
      salaryMin: s.min,
      salaryMax: s.max,
      salaryText: s.text,
      description: htmlToText(String(posting.description ?? '')),
      publishedAt: posting.datePosted ? new Date(posting.datePosted).toISOString() : null,
    };
  }

  // Fallback: main content text.
  const body = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? /<body[\s\S]*?<\/body>/i.exec(html)?.[0] ?? html;
  const text = htmlToText(body.replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' '));
  if (text.length < 200) throw new HttpError(422, 'Impossible de lire l’annonce sur cette page (contenu chargé dynamiquement) : colle son texte.', { pasteText: true });
  const title = meta('og:title') || htmlToText(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  return {
    source: 'import',
    sourceId: url.href.slice(0, 500),
    url: url.href,
    title: title.slice(0, 300),
    company: meta('og:site_name'),
    location: '',
    description: text.slice(0, 40000),
    publishedAt: null,
  };
}

/** Pasted text → offer (title / company guessed by the analyzer). */
export function importFromText(text: string, meta: { title?: string; company?: string; url?: string } = {}): NormalizedOffer {
  const clean = htmlToText(text).slice(0, 60000);
  if (clean.length < 40) throw new HttpError(400, 'Texte trop court pour être une annonce');
  const firstLine = clean.split('\n').find((l) => l.trim().length > 3)?.trim() ?? 'Annonce importée';
  let h = 0;
  for (let i = 0; i < clean.length; i++) h = (Math.imul(31, h) + clean.charCodeAt(i)) | 0;
  return {
    source: 'import',
    sourceId: meta.url?.slice(0, 500) || `text-${(h >>> 0).toString(36)}`,
    url: meta.url ?? '',
    title: (meta.title || firstLine).slice(0, 300),
    company: meta.company ?? '',
    location: '',
    description: clean,
    publishedAt: null,
  };
}
