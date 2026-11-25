/**
 * Parse a job-alert email (LinkedIn, Cadremploi, APEC, Welcome to the Jungle,
 * Indeed, HelloWork, France Travail…) forwarded by the user to the inbound
 * address. We only read the email the user received — no site is scraped.
 */
import { decodeEntities, htmlToText, normalize } from '../../shared/analysis/text.js';
import type { NormalizedOffer } from '../../shared/types.js';

interface Provider {
  id: string;
  label: string;
  host: RegExp;
  /** Extract a stable id + canonical URL from a link. */
  job(u: URL): { id: string; url: string } | null;
}

const PROVIDERS: Provider[] = [
  {
    id: 'linkedin',
    label: 'LinkedIn',
    host: /linkedin\.com$/,
    job: (u) => {
      const m = /\/jobs\/view\/(?:[^/]*-)?(\d{6,})/.exec(u.pathname) ?? /currentJobId=(\d{6,})/.exec(u.search);
      return m ? { id: `li-${m[1]}`, url: `https://www.linkedin.com/jobs/view/${m[1]}/` } : null;
    },
  },
  {
    id: 'cadremploi',
    label: 'Cadremploi',
    host: /cadremploi\.fr$/,
    job: (u) => {
      const m = /offreId=(\d+)/i.exec(u.search) ?? /\/(?:detail_offre|offre)[^\d]*(\d{6,})/.exec(u.pathname);
      return m ? { id: `ce-${m[1]}`, url: `https://www.cadremploi.fr/emploi/detail_offre?offreId=${m[1]}` } : null;
    },
  },
  {
    id: 'apec',
    label: 'APEC',
    host: /apec\.fr$/,
    job: (u) => {
      const m = /detail-offre\/(\d+[A-Z]?)/i.exec(u.pathname) ?? /numeroOffre=(\d+[A-Z]?)/i.exec(u.search);
      return m ? { id: `apec-${m[1]}`, url: `https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/${m[1]}` } : null;
    },
  },
  {
    id: 'wttj',
    label: 'Welcome to the Jungle',
    host: /welcometothejungle\.com$/,
    job: (u) => {
      const m = /\/companies\/([\w-]+)\/jobs\/([\w-]+)/.exec(u.pathname);
      return m ? { id: `wttj-${m[1]}-${m[2]}`.slice(0, 200), url: `https://www.welcometothejungle.com/fr/companies/${m[1]}/jobs/${m[2]}` } : null;
    },
  },
  {
    id: 'indeed',
    label: 'Indeed',
    host: /indeed\.(com|fr)$/,
    job: (u) => {
      const jk = u.searchParams.get('jk') ?? u.searchParams.get('vjk');
      return jk ? { id: `indeed-${jk}`, url: `https://fr.indeed.com/viewjob?jk=${jk}` } : null;
    },
  },
  {
    id: 'hellowork',
    label: 'HelloWork',
    host: /hellowork\.com$/,
    job: (u) => {
      const m = /\/emplois\/(\d+)\.html/.exec(u.pathname);
      return m ? { id: `hw-${m[1]}`, url: `https://www.hellowork.com/fr-fr/emplois/${m[1]}.html` } : null;
    },
  },
  {
    id: 'france_travail',
    label: 'France Travail',
    host: /francetravail\.fr$|pole-emploi\.fr$/,
    job: (u) => {
      const m = /\/detail\/(\w{6,})/.exec(u.pathname);
      return m ? { id: `ft-${m[1]}`, url: `https://candidat.francetravail.fr/offres/recherche/detail/${m[1]}` } : null;
    },
  },
];

const CTA = /^(voir|consulter|postuler|candidater|view|apply|see|en savoir plus|decouvrir|lire|acceder|plus d'infos|details?|voir l'offre|voir l'annonce|voir le poste|voir toutes|see all|unsubscribe|se desabonner|desinscri|gerer|manage|modifier|parametres|help|aide|confidentialite|privacy|linkedin|cadremploi|apec|indeed|hellowork|welcome to the jungle|france travail)\b/;

/** Unwrap tracking redirects (?url=https://…). */
function unwrap(href: string): URL | null {
  let u: URL;
  try {
    u = new URL(decodeEntities(href.trim()));
  } catch {
    return null;
  }
  for (let i = 0; i < 2; i++) {
    for (const k of ['url', 'u', 'redirect', 'redirect_url', 'dest', 'destination', 'target', 'r', 'link']) {
      const v = u.searchParams.get(k);
      if (v && /^https?:\/\//.test(v)) {
        try {
          u = new URL(v);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return /^https?:$/.test(u.protocol) ? u : null;
}

function providerFor(host: string): Provider | undefined {
  const h = host.replace(/^www\./, '');
  return PROVIDERS.find((p) => p.host.test(h) || h.split('.').some((_, i, a) => p.host.test(a.slice(i).join('.'))));
}

function lines(html: string): string[] {
  return htmlToText(html)
    .split('\n')
    .map((l) => l.replace(/^[•·\-\s]+/, '').trim())
    .filter((l) => l.length > 1);
}

const JOB_WORDS = /(h\/f|f\/h|\(f\/h\)|developpeu|ingenieu|chef|responsable|manager|charge|assistant|consultant|designer|commercial|technicien|analyste|directeur|lead|architecte|comptable|juriste|stagiaire|alternant|business|account|product|data|marketing|communication|\brh\b|\bux\b|\bui\b|engineer|developer)/;

const PLACE = /(\(\d{2,3}\)|\b\d{5}\b|france|paris|lyon|marseille|toulouse|lille|bordeaux|nantes|nice|rennes|strasbourg|montpellier|grenoble|region|ile-de-france|auvergne|bretagne|normandie|occitanie|teletravail|hybride|remote|sur site|,)/;

export interface ParsedAlert {
  provider: string;
  offers: NormalizedOffer[];
}

export function parseAlertEmail(input: { html?: string | null; text?: string | null; subject?: string; from?: string }): ParsedAlert {
  const html = input.html || (input.text ?? '').replace(/(https?:\/\/[^\s<>"]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>');
  const fromProvider = PROVIDERS.find((p) => normalize(`${input.from ?? ''} ${input.subject ?? ''}`).includes(p.id.replace('_', ' ')) || normalize(input.from ?? '').includes(p.label.toLowerCase().split(' ')[0]));
  const out = new Map<string, NormalizedOffer>();
  const labels = new Set<string>();
  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchorRe)) {
    const u = unwrap(m[1]);
    if (!u) continue;
    const prov = providerFor(u.hostname) ?? (fromProvider && /job|emploi|offre|poste|career|carriere/i.test(u.pathname + u.search) ? fromProvider : undefined);
    if (!prov) continue;
    const job = prov.job(u);
    let text = htmlToText(m[2]).replace(/\s+/g, ' ').trim();
    const nText = normalize(text);
    const before = lines(html.slice(Math.max(0, (m.index ?? 0) - 1500), m.index));
    const after = lines(html.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 1200));
    let ctaContext: string[] | null = null;
    if (!text || text.length < 4 || CTA.test(nText) || /^https?:/.test(text)) {
      // CTA button ("Voir l'offre"): the title is the closest job-like line above it,
      // and the lines between that title and the button carry company / location.
      if (!job) continue;
      const near = before.slice(-6).filter((l) => l.length <= 120 && !CTA.test(normalize(l)));
      let idx = -1;
      for (let i = near.length - 1; i >= 0; i--) if (JOB_WORDS.test(normalize(near[i]))) {
        idx = i;
        break;
      }
      if (idx < 0) {
        for (let i = near.length - 1; i >= 0; i--) {
          if (near[i].length >= 6 && !PLACE.test(normalize(near[i]))) {
            idx = i;
            break;
          }
        }
      }
      if (idx < 0) continue;
      text = near[idx];
      ctaContext = near.slice(idx + 1);
    }
    if (text.length > 140 || text.length < 4) continue;
    const id = job?.id ?? `${prov.id}-${normalize(text).replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`;
    if (out.has(id)) continue;
    if (!job && !JOB_WORDS.test(normalize(text))) continue;
    // Company / location are usually the 1-2 lines right after the title.
    let company = '';
    let location = '';
    const next = (ctaContext ?? after.filter((l) => !CTA.test(normalize(l)))).slice(0, 3);
    if (next[0]?.includes(' · ')) {
      [company, location] = next[0].split(' · ').map((s) => s.trim());
    } else {
      if (next[0] && next[0].length <= 80 && !PLACE.test(normalize(next[0]))) company = next[0];
      const loc = next.find((l) => l.length <= 80 && PLACE.test(normalize(l)));
      if (loc) location = loc;
    }
    labels.add(prov.label);
    out.set(id, {
      source: 'email',
      sourceId: id,
      url: job?.url ?? u.href,
      title: text,
      company,
      location,
      description: [text, company, location, `Offre repérée dans une alerte email ${prov.label}${input.subject ? ` (« ${input.subject} »)` : ''}. Ouvre l’annonce pour lire la description complète, puis colle-la dans l’analyse pour un score précis.`]
        .filter(Boolean)
        .join('\n'),
      publishedAt: new Date().toISOString(),
    });
  }
  return { provider: fromProvider?.label ?? ([...labels].join(', ') || 'email'), offers: [...out.values()].slice(0, 60) };
}
