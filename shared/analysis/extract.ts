import type { ContractType, RemoteMode } from '../types.js';
import { compileSkills, LANGUAGES, type CompiledSkill, type SkillCategory } from './skills.js';
import { htmlToText, normalize, sentences, tokenize, wordCount } from './text.js';

export interface SkillHit {
  id: string;
  label: string;
  cat: SkillCategory;
  count: number;
  required: boolean;
}

export interface SalaryInfo {
  min: number | null;
  max: number | null;
  period: 'year' | 'month' | 'day' | 'hour';
  annualMin: number | null;
  annualMax: number | null;
  text: string;
}

export interface Signal {
  tone: 'positive' | 'warning' | 'info';
  label: string;
}

export interface AdAnalysis {
  title: string;
  company: string;
  location: string;
  contract: ContractType | null;
  contractMonths: number | null;
  remote: RemoteMode | null;
  remoteDays: number | null;
  salary: SalaryInfo | null;
  experience: { min: number | null; max: number | null; text: string } | null;
  seniority: 'junior' | 'confirmé' | 'senior' | 'lead' | null;
  educationLevel: number | null;
  languages: Array<{ id: string; label: string; level: string | null; required: boolean }>;
  skills: SkillHit[];
  softSkills: SkillHit[];
  keywords: string[];
  signals: Signal[];
  wordCount: number;
  readingMinutes: number;
}

export interface AnalyzeInput {
  text: string;
  /** Known metadata (from an API) — wins over what the text suggests. */
  title?: string;
  company?: string;
  location?: string;
  contract?: ContractType | null;
  remote?: RemoteMode | null;
  salaryText?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  /** Profile skills to detect in addition to the dictionary. */
  extraSkills?: Array<{ name: string }>;
}

/* ───────────────────────── sections ───────────────────────── */

type Zone = 'profile' | 'missions' | 'company' | 'benefits' | 'nice' | 'other';

const HEADINGS: Array<[Zone, RegExp]> = [
  ['nice', /(un plus|serait un plus|seraient un plus|nice to have|bonus|idealement|appreci|souhaite)/],
  ['profile', /(profil|competences|qualifications|requirements|prerequis|pre-requis|ce que nous attendons|vous etes|vous avez|savoir[- ]faire|votre experience|must have|who you are|what you bring|ce que vous apportez|exigences)/],
  ['missions', /(missions?|responsabilites|vos taches|le poste|description du poste|ce que vous ferez|your role|what you.ll do|au quotidien|activites|role)/],
  ['company', /(qui sommes[- ]nous|l'entreprise|a propos|about us|notre societe|presentation de|l'equipe|notre client)/],
  ['benefits', /(avantages|ce que nous offrons|nous vous offrons|pourquoi nous rejoindre|package|remuneration|conditions|benefits|perks|ce que l'on vous propose)/],
];

function zoneOfHeading(line: string): Zone | null {
  const n = normalize(line).replace(/[:\-–•*#]+\s*$/, '').trim();
  if (!n || n.length > 70) return null;
  // A heading is short and usually ends with ":" or has no sentence punctuation.
  const looksHeading = /:\s*$/.test(line.trim()) || n.split(' ').length <= 7;
  if (!looksHeading) return null;
  for (const [zone, re] of HEADINGS) if (re.test(n)) return zone;
  return null;
}

function splitZones(text: string): Array<{ zone: Zone; text: string }> {
  const out: Array<{ zone: Zone; text: string }> = [];
  let zone: Zone = 'other';
  let buf: string[] = [];
  const flush = (): void => {
    if (buf.length) out.push({ zone, text: buf.join('\n') });
    buf = [];
  };
  for (const raw of text.split('\n')) {
    const z = zoneOfHeading(raw);
    if (z) {
      flush();
      zone = z;
      // Heading with inline content ("Profil : 3 ans d'expérience en React")
      const after = raw.split(':').slice(1).join(':').trim();
      if (after.length > 3) buf.push(after);
      continue;
    }
    buf.push(raw);
  }
  flush();
  return out;
}

/* ───────────────────────── contract / remote ───────────────────────── */

const CONTRACT_PATTERNS: Array<[ContractType, RegExp]> = [
  ['Alternance', /\b(alternance|alternant|apprentissage|apprenti|contrat de professionnalisation|contrat pro)\b/],
  ['Stage', /\b(stage|stagiaire|internship|intern)\b/],
  ['Freelance', /\b(freelance|free-lance|independant|portage salarial|tjm|taux journalier|mission freelance)\b/],
  ['Intérim', /\b(interim|interimaire|travail temporaire|mission d'interim)\b/],
  ['CDD', /\b(cdd|contrat a duree determinee|duree determinee)\b/],
  ['CDI', /\b(cdi|contrat a duree indeterminee|duree indeterminee|permanent contract)\b/],
];

export function detectContract(n: string): { contract: ContractType | null; months: number | null } {
  let best: { contract: ContractType; idx: number } | null = null;
  for (const [c, re] of CONTRACT_PATTERNS) {
    const m = re.exec(n);
    if (m && (best === null || m.index < best.idx)) best = { contract: c, idx: m.index };
  }
  let months: number | null = null;
  const dm = /(?:cdd|duree|mission|stage|contrat)[^.\n]{0,25}?(\d{1,2})\s*mois/.exec(n);
  if (dm) months = Number(dm[1]);
  return { contract: best?.contract ?? null, months };
}

export function detectRemote(n: string): { remote: RemoteMode | null; days: number | null } {
  if (/\b(100\s?% (en )?teletravail|full[- ]?remote|teletravail (total|complet|integral)|remote[- ]first|entierement a distance|poste a distance|fully remote)\b/.test(n))
    return { remote: 'full', days: 5 };
  const d =
    /(\d)\s*(?:jours?|j)\s*(?:de |par semaine de |\/\s?semaine de )?(?:teletravail|remote)/.exec(n) ??
    /(?:teletravail|remote)[^.\n]{0,30}?(\d)\s*(?:jours?|j)\b/.exec(n);
  if (d) return { remote: Number(d[1]) >= 5 ? 'full' : 'hybrid', days: Number(d[1]) };
  if (/\b(pas de teletravail|teletravail non|aucun teletravail|100\s?% (sur site|presentiel)|uniquement sur site|no remote)\b/.test(n))
    return { remote: 'onsite', days: 0 };
  if (/\b(hybride|teletravail partiel|teletravail possible|teletravail occasionnel|hybrid|remote partiel|teletravail)\b/.test(n))
    return { remote: 'hybrid', days: null };
  return { remote: null, days: null };
}

/* ───────────────────────── salary ───────────────────────── */

const ANNUAL_FACTOR = { year: 1, month: 12, day: 218, hour: 1607 } as const;

function toNumber(raw: string, k: string | undefined): number {
  const cleaned = raw.replace(/[\s  .](?=\d{3}\b)/g, '').replace(',', '.');
  let v = parseFloat(cleaned);
  if (k) v *= 1000;
  return v;
}

export function parseSalary(input: string): SalaryInfo | null {
  if (!input) return null;
  const n = normalize(input);
  // France Travail format: "Annuel de 38000.0 Euros à 42000.0 Euros sur 12 mois"
  const ft = /(annuel|mensuel|horaire)\s+de\s+([\d\s.,]+)\s*euros?(?:\s+a\s+([\d\s.,]+)\s*euros?)?/.exec(n);
  let min: number | null = null;
  let max: number | null = null;
  let period: SalaryInfo['period'] | null = null;
  let text = '';
  if (ft) {
    min = parseFloat(ft[2].replace(/\s/g, ''));
    max = ft[3] ? parseFloat(ft[3].replace(/\s/g, '')) : null;
    period = ft[1] === 'annuel' ? 'year' : ft[1] === 'mensuel' ? 'month' : 'hour';
    text = input.slice(0, 120);
  } else {
    const num = String.raw`(\d{1,3}(?:[\s  .]\d{3})+|\d+(?:[.,]\d+)?)\s*(k)?`;
    const cur = String.raw`\s*(?:€|eur(?:os?)?|k€|keur)`;
    const range = new RegExp(String.raw`(?:entre|de)?\s*${num}${cur}?\s*(?:-|a|et|à|/|~)\s*${num}${cur}`, 'g');
    const single = new RegExp(String.raw`${num}${cur}`, 'g');
    let m: RegExpExecArray | null = null;
    for (const cand of n.matchAll(range)) {
      const a = toNumber(cand[1], cand[2] ?? (cand[4] && !cand[2] && /k/.test(cand[0]) ? 'k' : undefined));
      const b = toNumber(cand[3], cand[4] ?? (/k€|keur/.test(cand[0]) ? 'k' : undefined));
      if (a > 0 && b >= a && b < 1_000_000) {
        m = cand;
        min = a < 1000 && b >= 1000 && /k/.test(cand[0]) ? a * 1000 : a;
        max = b;
        break;
      }
    }
    if (!m) {
      for (const cand of n.matchAll(single)) {
        const v = toNumber(cand[1], cand[2] ?? (/k€|keur/.test(cand[0]) ? 'k' : undefined));
        // Ignore small amounts that are bonuses / tickets restaurant.
        const ctx = n.slice(Math.max(0, cand.index - 40), cand.index + cand[0].length + 30);
        if (/(ticket|titre|restaurant|prime de|bonus|mutuelle|transport|capital|chiffre d'affaires|ca de|levee|million|m€)/.test(ctx)) continue;
        if (v >= 8 && v < 1_000_000) {
          m = cand;
          min = v;
          max = null;
          break;
        }
      }
    }
    if (!m || min === null) return null;
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const ctx = n.slice(Math.max(0, start - 50), end + 50);
    // Period: the amount's own notation first, then what follows it, then what precedes it closely.
    const after = n.slice(end, end + 28);
    const before = n.slice(Math.max(0, start - 22), start);
    const periodOf = (t: string): SalaryInfo['period'] | null =>
      /(\/\s?jour|par jour|tjm|journalier|\/\s?j\b|jour)/.test(t)
        ? 'day'
        : /(\/\s?h\b|de l'heure|horaire|par heure|\/\s?heure)/.test(t)
          ? 'hour'
          : /(\/\s?mois|par mois|mensuel)/.test(t)
            ? 'month'
            : /(\/\s?an\b|par an|annuel|k€|keur|package)/.test(t)
              ? 'year'
              : null;
    period = /k\s*(€|eur)|\dk\b/.test(m[0]) ? 'year' : periodOf(after) ?? periodOf(before);
    const hit = m[0].trim();
    const line = input.split('\n').find((l) => normalize(l).includes(hit)) ?? '';
    const tail = after.match(/^\s*(?:brut|net)?\s*(?:\/\s?(?:jour|j|mois|an|h|heure)|par (?:jour|mois|an|heure)|(?:annuel|mensuel)s?)/)?.[0] ?? '';
    text = (input.length < 160 ? input : line.length <= 90 && line ? line : `${hit}${tail}`).trim().replace(/^[•\-*\s]+/, '').slice(0, 160);
    void ctx;
  }
  const ref = max ?? min ?? 0;
  if (!period) period = ref >= 10000 ? 'year' : ref >= 1000 ? 'month' : ref >= 100 ? 'day' : 'hour';
  // Plausibility.
  if (period === 'year' && ref < 8000) return null;
  const f = ANNUAL_FACTOR[period];
  return {
    min,
    max,
    period,
    annualMin: min !== null ? Math.round(min * f) : null,
    annualMax: max !== null ? Math.round(max * f) : min !== null ? Math.round(min * f) : null,
    text,
  };
}

/* ───────────────────────── experience / education ───────────────────────── */

export function detectExperience(n: string): AdAnalysis['experience'] {
  const ft = /experience exigee de (\d+) an/.exec(n) ?? /(\d+) an\(s\) d'experience/.exec(n);
  if (ft) return { min: Number(ft[1]), max: null, text: ft[0] };
  const range = /(\d{1,2})\s*(?:a|-|à)\s*(\d{1,2})\s*ans?\s*(?:d'|minimum d'|d')?(?:experience|exp\b)/.exec(n);
  if (range) return { min: Number(range[1]), max: Number(range[2]), text: range[0] };
  const plus =
    /(?:au moins|minimum|min\.?|plus de|\+ de|>)\s*(\d{1,2})\s*ans/.exec(n) ??
    /(\d{1,2})\s*\+?\s*ans?\s*(?:minimum\s*)?(?:d'|d’|de |en )?(?:experience|exp\b|xp\b|d'anciennete)/.exec(n) ??
    /experience\s*(?:significative|reussie|confirmee|professionnelle)?\s*(?:de|d'au moins|minimum de|d'environ)\s*(\d{1,2})\s*ans/.exec(n) ??
    /(\d{1,2})\+?\s*(?:years|yrs)/.exec(n);
  if (plus) return { min: Number(plus[1]), max: null, text: plus[0] };
  if (/(debutant accepte|debutants acceptes|premiere experience|jeune diplome|junior|sans experience)/.test(n))
    return { min: 0, max: 2, text: 'débutant / junior accepté' };
  return null;
}

export function detectSeniority(n: string, exp: AdAnalysis['experience']): AdAnalysis['seniority'] {
  if (/\b(lead|head of|principal|staff engineer|directeur|directrice|responsable d'equipe|manager)\b/.test(n.slice(0, 200)))
    return 'lead';
  if (/\bsenior\b|\bsr\.?\b|confirme\/senior|expert\b/.test(n)) return 'senior';
  if (/\bjunior\b|\bjr\.?\b|debutant|jeune diplome/.test(n)) return 'junior';
  if (/\bconfirme\b|\bconfirmee\b|\bmid[- ]level\b/.test(n)) return 'confirmé';
  if (exp?.min != null) return exp.min >= 6 ? 'senior' : exp.min >= 3 ? 'confirmé' : 'junior';
  return null;
}

export function detectEducation(n: string): number | null {
  const bac = /bac\s*\+\s*(\d)/.exec(n);
  if (bac) return Number(bac[1]);
  if (/(doctorat|phd|these)/.test(n)) return 8;
  if (/(master|ecole d'ingenieur|ecole de commerce|diplome d'ingenieur|mba|msc)/.test(n)) return 5;
  if (/(licence|bachelor|\bbut\b)/.test(n)) return 3;
  if (/(bts|dut|deust)/.test(n)) return 2;
  if (/\bbac\b|baccalaureat/.test(n)) return 0;
  return null;
}

function detectLanguages(n: string): AdAnalysis['languages'] {
  const out: AdAnalysis['languages'] = [];
  for (const lang of LANGUAGES) {
    for (const a of lang.aliases) {
      const re = new RegExp(`(?<![a-z])${a}(?![a-z])([^.\\n]{0,40})`);
      const m = re.exec(n);
      if (!m) continue;
      const near = n.slice(Math.max(0, m.index - 40), m.index + 60);
      // "anglais" in a company/market context ("clients anglais") is not a requirement.
      const level =
        /(bilingue|natif|native|c2)/.exec(near)?.[1] ??
        /(courant|fluent|c1|professionnel|operationnel|b2)/.exec(near)?.[1] ??
        /(intermediaire|b1|scolaire|notions|lu,? ecrit)/.exec(near)?.[1] ??
        null;
      const required = !/(un plus|serait un plus|apprecie|souhaite|idealement|bonus)/.test(near);
      out.push({ id: lang.id, label: lang.label, level, required });
      break;
    }
  }
  return out;
}

/* ───────────────────────── signals ───────────────────────── */

const POSITIVE: Array<[RegExp, string]> = [
  [/(tickets? restaurants?|titres?[- ]restaurant|carte swile|panier repas)/, 'Titres-restaurant'],
  [/(mutuelle|prevoyance)/, 'Mutuelle / prévoyance'],
  [/\brtt\b/, 'RTT'],
  [/(interessement|participation aux benefices|epargne salariale|pee\b)/, 'Intéressement / participation'],
  [/(13e mois|13eme mois|treizieme mois)/, '13e mois'],
  [/(bspce|stock[- ]options|actionnariat)/, 'Actionnariat / BSPCE'],
  [/(semaine de 4 jours|4 jours par semaine)/, 'Semaine de 4 jours'],
  [/(horaires flexibles|flexibilite horaire|horaires libres)/, 'Horaires flexibles'],
  [/(budget formation|plan de formation|formations? certifiantes?|conferences)/, 'Formation'],
  [/(remboursement (du )?transport|forfait mobilite|\bvelo\b|\bvae\b)/, 'Mobilité prise en charge'],
  [/(prime|variable|bonus annuel)/, 'Rémunération variable / primes'],
  [/(materiel au choix|macbook)/, 'Matériel au choix'],
];

const WARNINGS: Array<[RegExp, string]> = [
  [/\bastreintes?\b/, 'Astreintes'],
  [/(week-?ends?|samedi|dimanche)/, 'Travail le week-end possible'],
  [/(deplacements? (frequents?|reguliers?|nationaux|internationaux)|nombreux deplacements)/, 'Déplacements fréquents'],
  [/(horaires decales|travail de nuit|3x8|2x8)/, 'Horaires décalés'],
  [/(urgent|asap|des que possible|immediatement)/, 'Prise de poste urgente'],
  [/(polyvalence|multi-casquettes|couteau suisse)/, 'Poste très polyvalent'],
  [/(forte pression|environnement exigeant|rythme soutenu|stress)/, 'Rythme soutenu annoncé'],
  [/(periode d'essai de (6|8) mois|periode d'essai renouvelable)/, 'Période d’essai longue'],
  [/(permis b (exige|obligatoire|indispensable)|vehicule personnel)/, 'Permis / véhicule exigé'],
];

/* ───────────────────────── meta from free text ───────────────────────── */

function guessTitle(lines: string[]): string {
  for (const l of lines.slice(0, 6)) {
    const t = l.replace(/^[#*•\-\s]+/, '').trim();
    if (t.length >= 4 && t.length <= 110 && !/^(offre|annonce|description|https?:)/i.test(t)) return t;
  }
  return '';
}

function guessCompany(text: string): string {
  const m =
    /(?:^|\n)\s*(?:entreprise|societe|société|employeur|company)\s*[:\-]\s*([^\n]{2,60})/i.exec(text) ??
    /\b([A-Z][\w&'’.-]+(?:\s[A-Z][\w&'’.-]+){0,3})\s+recrute\b/.exec(text) ??
    /\b(?:rejoindre|rejoignez|chez)\s+([A-Z][\w&'’.-]+(?:\s[A-Z][\w&'’.-]+){0,3})/.exec(text);
  return m ? m[1].trim().replace(/[,.;:]$/, '') : '';
}

function guessLocation(text: string): string {
  const m =
    /(?:^|\n)\s*(?:lieu|localisation|location|adresse|ville|lieu de travail)\s*[:\-]\s*([^\n]{2,60})/i.exec(text) ??
    /\b(?:base|basee|situe|situee|poste)\s+a\s+([A-Z][a-zA-ZÀ-ÿ'’\- ]{2,40}?)(?=[\s,.;(]|$)/.exec(
      text.normalize('NFD').replace(/[̀-ͯ]/g, ''),
    );
  return m ? m[1].trim().replace(/[,.;:]$/, '') : '';
}

/* ───────────────────────── skills ───────────────────────── */

function scanSkills(zones: Array<{ zone: Zone; text: string }>, dict: CompiledSkill[]): SkillHit[] {
  const hits = new Map<string, SkillHit>();
  for (const { zone, text } of zones) {
    for (const sentence of sentences(normalize(text))) {
      // Skills cited in the company / benefits blurb describe the context, not the requirements.
      const niceSentence = zone === 'nice' || zone === 'company' || zone === 'benefits' || /(un plus|serait un plus|apprecie|idealement|souhaite|bonus|nice to have|est un atout|serait appreciee?)/.test(sentence);
      const mustSentence = /(maitrise|indispensable|obligatoire|requis|exige|imperati|must|necessaire|solide|excellente? connaissance|expertise)/.test(sentence);
      for (const s of dict) {
        let count = 0;
        for (const re of s.res) {
          re.lastIndex = 0;
          const found = sentence.match(re);
          if (found) count += found.length;
        }
        if (!count) continue;
        const required = mustSentence || !niceSentence;
        const prev = hits.get(s.id);
        if (prev) {
          prev.count += count;
          prev.required = prev.required || required;
        } else {
          hits.set(s.id, { id: s.id, label: s.label, cat: s.cat, count, required });
        }
      }
    }
  }
  return [...hits.values()].sort((a, b) => Number(b.required) - Number(a.required) || b.count - a.count);
}

function topKeywords(n: string, exclude: Set<string>, k = 12): string[] {
  const freq = new Map<string, number>();
  for (const t of tokenize(n)) {
    if (t.length < 4 || /^\d+$/.test(t) || exclude.has(t)) continue;
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return [...freq.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([t]) => t);
}

/* ───────────────────────── main ───────────────────────── */

export function analyzeAd(input: AnalyzeInput): AdAnalysis {
  const text = htmlToText(input.text ?? '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const n = normalize(text);
  const header = normalize([input.title, input.contract, input.salaryText].filter(Boolean).join('\n'));

  const zones = splitZones(text);
  const dict = compileSkills(input.extraSkills ?? []);
  const allHits = scanSkills(
    input.title ? [{ zone: 'profile', text: input.title }, ...zones] : zones,
    dict,
  );

  const { contract: c1, months } = detectContract(`${header}\n${n}`);
  const { remote: r1, days } = detectRemote(n);
  const salary =
    input.salaryMin || input.salaryMax
      ? (() => {
          const min = input.salaryMin ?? null;
          const max = input.salaryMax ?? null;
          const ref = max ?? min ?? 0;
          const period: SalaryInfo['period'] = ref >= 10000 ? 'year' : ref >= 1000 ? 'month' : ref >= 100 ? 'day' : 'hour';
          const f = ANNUAL_FACTOR[period];
          return {
            min,
            max,
            period,
            annualMin: min !== null ? Math.round(min * f) : null,
            annualMax: max !== null ? Math.round(max * f) : min !== null ? Math.round(min * f) : null,
            text: input.salaryText || '',
          } satisfies SalaryInfo;
        })()
      : parseSalary(input.salaryText ?? '') ?? parseSalary(text);
  const experience = detectExperience(n);
  const seniority = detectSeniority(normalize(`${input.title ?? ''}\n${n}`), experience);

  const signals: Signal[] = [];
  for (const [re, label] of POSITIVE) if (re.test(n)) signals.push({ tone: 'positive', label });
  for (const [re, label] of WARNINGS) if (re.test(n)) signals.push({ tone: 'warning', label });
  if (!salary) signals.push({ tone: 'info', label: 'Salaire non communiqué' });
  const wc = wordCount(text);
  if (wc < 120) signals.push({ tone: 'info', label: 'Annonce très courte : analyse partielle' });

  const company = input.company?.trim() || guessCompany(text);
  const exclude = new Set<string>();
  for (const h of allHits) for (const t of tokenize(h.label)) exclude.add(t);
  for (const t of tokenize(company)) exclude.add(t);

  return {
    title: input.title?.trim() || guessTitle(lines),
    company,
    location: input.location?.trim() || guessLocation(text),
    contract: input.contract ?? c1,
    contractMonths: months,
    remote: input.remote ?? r1,
    remoteDays: days,
    salary,
    experience,
    seniority,
    educationLevel: detectEducation(n),
    languages: detectLanguages(n),
    skills: allHits.filter((h) => h.cat !== 'soft'),
    softSkills: allHits.filter((h) => h.cat === 'soft'),
    keywords: topKeywords(n, exclude),
    signals,
    wordCount: wc,
    readingMinutes: Math.max(1, Math.round(wc / 220)),
  };
}
