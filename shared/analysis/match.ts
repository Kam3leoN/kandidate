import type { Profile } from '../types.js';
import type { AdAnalysis } from './extract.js';
import { canonicalSkillId } from './skills.js';
import { normalize, stem, tokenize } from './text.js';

export type MatchKey = 'skills' | 'title' | 'experience' | 'contract' | 'salary' | 'location' | 'languages';

export interface MatchPart {
  key: MatchKey;
  label: string;
  weight: number;
  /** 0..1, null when the ad does not say (excluded from the score). */
  score: number | null;
  detail: string;
}

export interface MatchResult {
  score: number;
  confidence: number;
  verdict: 'excellent' | 'bon' | 'moyen' | 'faible';
  parts: MatchPart[];
  matchedSkills: string[];
  missingRequired: string[];
  missingNice: string[];
  dealbreakers: string[];
  strengths: string[];
  advice: string[];
}

const WEIGHTS: Record<MatchKey, number> = {
  skills: 34,
  title: 20,
  experience: 12,
  contract: 10,
  salary: 10,
  location: 10,
  languages: 4,
};

const LABELS: Record<MatchKey, string> = {
  skills: 'Compétences',
  title: 'Intitulé du poste',
  experience: 'Expérience',
  contract: 'Contrat',
  salary: 'Rémunération',
  location: 'Lieu & télétravail',
  languages: 'Langues',
};

/* Job-title synonyms → canonical token. */
const TITLE_SYNONYMS: Array<[RegExp, string]> = [
  [/\b(developpeu(r|se)|developer|dev|programmeur|software engineer|ingenieur logiciel|ingenieur developpement)\b/g, 'developpeur'],
  [/\b(front[- ]?end|front|integrateur|integratrice|ui developer)\b/g, 'frontend'],
  [/\b(back[- ]?end|back)\b/g, 'backend'],
  [/\b(full[- ]?stack)\b/g, 'fullstack'],
  [/\b(ingenieur|engineer)\b/g, 'ingenieur'],
  [/\b(chef de projets?|project manager|gestionnaire de projet|responsable de projet|pmo)\b/g, 'chefdeprojet'],
  [/\b(product owner|po|product manager|chef de produit|pm)\b/g, 'produit'],
  [/\b(designer|concepteur|conceptrice|graphiste|webdesigner|web designer)\b/g, 'designer'],
  [/\b(ux|ui|ux\/ui|ui\/ux|product designer)\b/g, 'uxui'],
  [/\b(responsable|manager|head of|directeur|directrice|lead)\b/g, 'responsable'],
  [/\b(commercial|commerciale|business developer|account executive|charge d'affaires|ingenieur commercial|sales)\b/g, 'commercial'],
  [/\b(charge de marketing|marketing manager|chef de projet marketing|traffic manager|growth)\b/g, 'marketing'],
  [/\b(data analyst|analyste de donnees|business analyst|bi)\b/g, 'dataanalyst'],
  [/\b(data scientist|ml engineer|machine learning engineer)\b/g, 'datascientist'],
  [/\b(devops|sre|ingenieur systeme|administrateur systeme|cloud engineer)\b/g, 'devops'],
  [/\b(tech lead|lead dev|lead developer|architecte)\b/g, 'techlead'],
  [/\b(assistant|assistante)\b/g, 'assistant'],
  [/\b(consultant|consultante)\b/g, 'consultant'],
  [/\b(animateur|animatrice|coordinateur|coordinatrice)\b/g, 'animateur'],
];

const TITLE_NOISE = new Set(['h', 'f', 'hf', 'x', 'cdi', 'cdd', 'stage', 'alternance', 'freelance', 'confirme', 'senior', 'junior', 'experimente']);

function titleTokens(s: string): Set<string> {
  let n = normalize(s).replace(/\(.*?\)/g, ' ');
  for (const [re, canon] of TITLE_SYNONYMS) n = n.replace(re, ` ${canon} `);
  return new Set(tokenize(n).filter((t) => !TITLE_NOISE.has(t)).map(stem));
}

export function titleSimilarity(a: string, b: string): number {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  // Overlap relative to the target title (what the candidate looks for).
  return inter / Math.min(A.size, B.size) * 0.7 + (inter / new Set([...A, ...B]).size) * 0.3;
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const fmtK = (v: number): string => `${Math.round(v / 1000)} k€`;
const clamp = (v: number): number => Math.max(0, Math.min(1, v));

export interface MatchContext {
  /** Offer coordinates when the source gives them. */
  lat?: number | null;
  lon?: number | null;
  /** Full ad text: excluded keywords are searched in it. */
  text?: string;
}

export function matchProfile(ad: AdAnalysis, profile: Profile, ctx: MatchContext = {}): MatchResult {
  const parts: MatchPart[] = [];
  const dealbreakers: string[] = [];
  const strengths: string[] = [];
  const advice: string[] = [];

  /* ── Skills */
  const mine = new Map<string, { name: string; level: number; core: boolean }>();
  for (const s of profile.skills) mine.set(canonicalSkillId(s.name), { name: s.name, level: s.level, core: !!s.core });
  const required = ad.skills.filter((s) => s.required);
  const nice = ad.skills.filter((s) => !s.required);
  const matched: string[] = [];
  const missingRequired: string[] = [];
  const missingNice: string[] = [];
  let reqScore = 0;
  for (const s of required) {
    const m = mine.get(s.id);
    if (m) {
      matched.push(s.label);
      reqScore += 0.6 + 0.4 * (m.level / 5);
    } else missingRequired.push(s.label);
  }
  let niceScore = 0;
  for (const s of nice) {
    const m = mine.get(s.id);
    if (m) {
      matched.push(s.label);
      niceScore += 0.6 + 0.4 * (m.level / 5);
    } else missingNice.push(s.label);
  }
  // Soft skills only count as a small bonus.
  const softMatched = ad.softSkills.filter((s) => mine.has(s.id)).map((s) => s.label);
  if (required.length || nice.length) {
    const rq = required.length ? reqScore / required.length : null;
    const nc = nice.length ? niceScore / nice.length : null;
    const base = rq !== null && nc !== null ? rq * 0.8 + nc * 0.2 : (rq ?? nc ?? 0);
    const bonus = Math.min(0.08, softMatched.length * 0.02);
    parts.push({
      key: 'skills',
      label: LABELS.skills,
      weight: WEIGHTS.skills,
      score: clamp(base + bonus),
      detail: `${matched.length}/${required.length + nice.length} compétences maîtrisées${missingRequired.length ? ` · manque : ${missingRequired.slice(0, 4).join(', ')}` : ''}`,
    });
  } else {
    parts.push({ key: 'skills', label: LABELS.skills, weight: WEIGHTS.skills, score: null, detail: 'Aucune compétence identifiable dans l’annonce' });
  }

  /* ── Title */
  if (ad.title && profile.targetTitles.length) {
    let best = 0;
    let bestTitle = '';
    for (const t of profile.targetTitles) {
      const sim = titleSimilarity(t, ad.title);
      if (sim > best) {
        best = sim;
        bestTitle = t;
      }
    }
    // A core skill in the title ("Développeur React") is a strong hint.
    const coreInTitle = profile.skills.some((s) => s.core && normalize(ad.title).includes(normalize(s.name)));
    const score = clamp(best + (coreInTitle ? 0.15 : 0));
    parts.push({
      key: 'title',
      label: LABELS.title,
      weight: WEIGHTS.title,
      score,
      detail: best > 0 ? `Proche de « ${bestTitle} » (${Math.round(best * 100)} %)` : 'Intitulé éloigné de tes postes cibles',
    });
    if (score >= 0.8) strengths.push('Intitulé aligné avec tes postes cibles');
  } else {
    parts.push({ key: 'title', label: LABELS.title, weight: WEIGHTS.title, score: null, detail: profile.targetTitles.length ? 'Intitulé inconnu' : 'Ajoute des postes cibles à ton profil' });
  }

  /* ── Experience */
  if (ad.experience?.min != null) {
    const need = ad.experience.min;
    const have = profile.experienceYears;
    let score = have >= need ? 1 : have >= need - 1 ? 0.75 : clamp(1 - (need - have) / 4);
    let detail = `${need} an${need > 1 ? 's' : ''} demandé${need > 1 ? 's' : ''}, tu en as ${have}`;
    if (ad.experience.max != null && have > ad.experience.max + 3) {
      score = Math.min(score, 0.7);
      detail += ' (risque de surqualification)';
      advice.push('Profil plus senior que demandé : précise ta motivation pour ce niveau de poste.');
    }
    if (have < need) advice.push(`Il te manque ~${need - have} an(s) d’expérience : valorise projets perso, freelance et responsabilités équivalentes.`);
    parts.push({ key: 'experience', label: LABELS.experience, weight: WEIGHTS.experience, score, detail });
  } else if (ad.seniority) {
    const lvl = profile.experienceYears >= 6 ? 'senior' : profile.experienceYears >= 3 ? 'confirmé' : 'junior';
    const order = ['junior', 'confirmé', 'senior', 'lead'];
    const diff = order.indexOf(ad.seniority) - order.indexOf(lvl);
    const score = diff <= 0 ? (diff < -1 ? 0.75 : 1) : diff === 1 ? 0.6 : 0.3;
    parts.push({ key: 'experience', label: LABELS.experience, weight: WEIGHTS.experience, score, detail: `Niveau ${ad.seniority} demandé, ton niveau : ${lvl}` });
  } else {
    parts.push({ key: 'experience', label: LABELS.experience, weight: WEIGHTS.experience, score: null, detail: 'Expérience non précisée' });
  }

  /* ── Contract */
  if (ad.contract) {
    const ok = profile.contracts.length === 0 || profile.contracts.includes(ad.contract);
    parts.push({ key: 'contract', label: LABELS.contract, weight: WEIGHTS.contract, score: ok ? 1 : 0.1, detail: ok ? `${ad.contract} recherché` : `${ad.contract} hors de tes contrats (${profile.contracts.join(', ')})` });
    if (!ok) dealbreakers.push(`Contrat ${ad.contract} non souhaité`);
  } else {
    parts.push({ key: 'contract', label: LABELS.contract, weight: WEIGHTS.contract, score: null, detail: 'Type de contrat non précisé' });
  }

  /* ── Salary */
  const sal = ad.salary;
  if (sal && (sal.annualMax || sal.annualMin) && (profile.salaryMin || profile.salaryTarget)) {
    const top = sal.annualMax ?? sal.annualMin ?? 0;
    const min = profile.salaryMin ?? (profile.salaryTarget ? profile.salaryTarget * 0.9 : 0);
    const target = profile.salaryTarget ?? min;
    let score: number;
    if (top >= target) score = 1;
    else if (top >= min) score = 0.75;
    else if (top >= min * 0.9) score = 0.45;
    else score = 0.15;
    const range = sal.annualMin && sal.annualMax && sal.annualMin !== sal.annualMax ? `${fmtK(sal.annualMin)}–${fmtK(sal.annualMax)}` : fmtK(top);
    parts.push({ key: 'salary', label: LABELS.salary, weight: WEIGHTS.salary, score, detail: `${range}/an estimé · ton minimum ${fmtK(min)}` });
    if (score <= 0.15) dealbreakers.push(`Rémunération sous ton minimum (${range})`);
    else if (score < 1) advice.push(`Fourchette sous ta cible (${fmtK(target)}) : prépare ta négociation (avantages, variable, télétravail).`);
    else strengths.push('Rémunération dans ta cible');
  } else {
    parts.push({ key: 'salary', label: LABELS.salary, weight: WEIGHTS.salary, score: null, detail: sal ? 'Renseigne ton salaire minimum dans le profil' : 'Salaire non communiqué' });
  }

  /* ── Location & remote */
  {
    let score: number | null = null;
    let detail = 'Lieu non précisé';
    const pref = profile.remotePref;
    if (ad.remote === 'full') {
      score = pref === 'onsite' ? 0.7 : 1;
      detail = '100 % télétravail';
    } else if (ctx.lat != null && ctx.lon != null && profile.location?.lat != null && profile.location?.lon != null) {
      const km = haversineKm({ lat: ctx.lat, lon: ctx.lon }, { lat: profile.location.lat, lon: profile.location.lon });
      const max = Math.max(5, profile.mobilityKm || 30);
      score = km <= max ? 1 : km <= max * 1.5 ? 0.6 : km <= max * 3 ? 0.3 : 0.05;
      detail = `≈ ${Math.round(km)} km de ${profile.location.label} (mobilité ${max} km)`;
      if (score <= 0.05) dealbreakers.push(`Trop loin (${Math.round(km)} km)`);
    } else if (ad.location && profile.location?.label) {
      const same = normalize(ad.location).includes(normalize(profile.location.label).split(/[ (,]/)[0]) ||
        (!!profile.location.dept && new RegExp(`\\b${profile.location.dept}\\b`).test(ad.location));
      score = same ? 1 : null;
      detail = same ? `Dans ta zone (${ad.location})` : `${ad.location} — distance inconnue`;
    }
    if (score !== null) {
      if (pref === 'remote' && ad.remote !== 'full') score *= ad.remote === 'hybrid' ? 0.8 : 0.45;
      if (pref === 'hybrid' && ad.remote === 'onsite') score *= 0.75;
      if (ad.remote === 'hybrid') detail += ad.remoteDays ? ` · ${ad.remoteDays} j de télétravail` : ' · télétravail partiel';
    } else if (ad.remote === 'hybrid' || ad.remote === 'onsite') {
      score = pref === 'remote' ? (ad.remote === 'hybrid' ? 0.6 : 0.2) : null;
      if (score !== null) detail = ad.remote === 'hybrid' ? 'Hybride alors que tu vises le full remote' : 'Sur site alors que tu vises le full remote';
    }
    parts.push({ key: 'location', label: LABELS.location, weight: WEIGHTS.location, score: score === null ? null : clamp(score), detail });
  }

  /* ── Languages */
  const reqLangs = ad.languages.filter((l) => l.required && l.id !== 'fr');
  if (reqLangs.length) {
    const mineL = new Map(profile.languages.map((l) => [normalize(l.name), l.level]));
    const levelRank = { notions: 1, intermédiaire: 2, courant: 3, bilingue: 4, natif: 5 } as const;
    const needRank = (lvl: string | null): number =>
      !lvl ? 2 : /(bilingue|natif|native|c2)/.test(lvl) ? 4 : /(courant|fluent|c1|professionnel|operationnel|b2)/.test(lvl) ? 3 : 2;
    let sum = 0;
    const gaps: string[] = [];
    for (const l of reqLangs) {
      const have = mineL.get(normalize(l.label));
      const h = have ? levelRank[have] : 0;
      const need = needRank(l.level);
      const s = h >= need ? 1 : h === need - 1 ? 0.6 : h > 0 ? 0.3 : 0;
      if (s < 1) gaps.push(`${l.label}${l.level ? ` ${l.level}` : ''}`);
      sum += s;
    }
    parts.push({ key: 'languages', label: LABELS.languages, weight: WEIGHTS.languages, score: sum / reqLangs.length, detail: gaps.length ? `À renforcer : ${gaps.join(', ')}` : reqLangs.map((l) => l.label).join(', ') + ' OK' });
  } else {
    parts.push({ key: 'languages', label: LABELS.languages, weight: WEIGHTS.languages, score: null, detail: 'Pas de langue étrangère exigée' });
  }

  /* ── Excluded keywords */
  const full = normalize(`${ad.title} ${ad.company} ${ad.keywords.join(' ')} ${ad.skills.map((s) => s.label).join(' ')} ${ctx.text ?? ''}`);
  for (const kw of profile.excludedKeywords) {
    const k = normalize(kw).trim();
    if (k && new RegExp(`(?<![a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(full)) dealbreakers.push(`Mot-clé exclu : « ${kw} »`);
  }

  /* ── Aggregate */
  const known = parts.filter((p) => p.score !== null);
  const totalW = parts.reduce((s, p) => s + p.weight, 0);
  const knownW = known.reduce((s, p) => s + p.weight, 0);
  let score = knownW ? (known.reduce((s, p) => s + (p.score ?? 0) * p.weight, 0) / knownW) * 100 : 50;
  // Few known dimensions → pull towards the middle (less certainty).
  const confidence = knownW / totalW;
  score = score * (0.55 + 0.45 * confidence) + 50 * (0.45 - 0.45 * confidence);
  if (dealbreakers.length) score = Math.min(score * 0.75, 45);
  score = Math.round(Math.max(0, Math.min(100, score)));

  /* ── Advice */
  if (missingRequired.length) {
    advice.unshift(`Compétences demandées absentes de ton profil : ${missingRequired.slice(0, 5).join(', ')}. Si tu les as pratiquées, ajoute-les ; sinon prépare un exemple d’apprentissage rapide.`);
  }
  if (matched.length) {
    const core = profile.skills.filter((s) => s.core).map((s) => canonicalSkillId(s.name));
    const coreMatched = ad.skills.filter((s) => core.includes(s.id)).map((s) => s.label);
    strengths.push(`Points forts à mettre en avant : ${(coreMatched.length ? coreMatched : matched).slice(0, 5).join(', ')}`);
  }
  if (missingNice.length && missingNice.length <= 4) advice.push(`Bonus cités : ${missingNice.join(', ')} — à mentionner si tu as des notions.`);
  if (ad.keywords.length) {
    const cv = normalize(profile.cvText);
    const absent = ad.keywords.filter((k) => !cv.includes(k)).slice(0, 6);
    if (cv && absent.length >= 3) advice.push(`Mots-clés de l’annonce absents de ton CV (utile pour les ATS) : ${absent.join(', ')}.`);
  }
  if (ad.signals.some((s) => s.label === 'Salaire non communiqué')) advice.push('Salaire non affiché : demande la fourchette dès le premier échange.');

  const verdict: MatchResult['verdict'] = score >= 80 ? 'excellent' : score >= 65 ? 'bon' : score >= 45 ? 'moyen' : 'faible';

  return {
    score,
    confidence: Math.round(confidence * 100) / 100,
    verdict,
    parts,
    matchedSkills: matched,
    missingRequired,
    missingNice,
    dealbreakers,
    strengths,
    advice,
  };
}
