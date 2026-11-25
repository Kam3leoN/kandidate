/**
 * Text helpers shared by the browser and the server (no DOM, no Node APIs).
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  acirc: 'â',
  ccedil: 'ç',
  ocirc: 'ô',
  ucirc: 'û',
  ugrave: 'ù',
  icirc: 'î',
  iuml: 'ï',
  euml: 'ë',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  euro: '€',
  middot: '·',
  bull: '•',
  ndash: '–',
  mdash: '—',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** HTML → readable plain text (block tags become line breaks, list items get bullets). */
export function htmlToText(html: string): string {
  if (!html) return '';
  if (!/[<&]/.test(html)) return html.trim();
  let s = html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li|ul|ol|tr|table|header|footer|blockquote)>/gi, '\n')
    .replace(/<(p|div|section|article|h[1-6]|ul|ol|tr|table|header|footer|blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .trim();
}

/** Lower-case, strip accents, unify quotes/dashes, collapse spaces. */
export function normalize(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ');
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex for a normalized alias with "word" boundaries that also work for
 * tokens such as `c++`, `c#`, `.net`, `node.js`, `ci/cd`.
 */
export function aliasRegex(alias: string, flags = 'g'): RegExp {
  const body = escapeRegExp(normalize(alias)).replace(/\\?\s+/g, '[\\s\\-_]*');
  return new RegExp(`(?<![a-z0-9+#.])${body}(?![a-z0-9+#]|\\.[a-z0-9])`, flags);
}

export const STOPWORDS = new Set(
  (
    'a au aux avec ce ces cette dans de des du elle en et eux il je la le les leur lui ma mais me meme mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous c d j l m n s t y ete etre avoir fait faire sont est ont sera seront plus moins tres tout tous toute toutes ainsi afin entre chez sans sous vers via selon dont ou alors aussi comme donc car si bien autre autres the and for with you your our are will have this that from about into who what when where which their they them can job role team equipe poste profil mission missions entreprise societe groupe client clients nous vous ans annee annees experience experiences travail travailler rejoindre recherche recherchons cdi cdd candidat candidature offre emploi h f hf f h e/ etc niveau bonne bon tres sein cadre ses leurs nos'
  ).split(/\s+/),
);

export function tokenize(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Very small French/English stemmer — enough to compare job titles. */
export function stem(t: string): string {
  let w = t;
  if (w.length > 5) w = w.replace(/(euses|euse|eurs|eur|rices|rice|ices|ice|ment|ments|tion|tions|ing|ers|er|es|s)$/, '');
  return w;
}

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function wordCount(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

export function truncate(s: string, n: number): string {
  if (!s || s.length <= n) return s ?? '';
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return `${cut.slice(0, sp > n * 0.6 ? sp : n).trimEnd()}…`;
}
