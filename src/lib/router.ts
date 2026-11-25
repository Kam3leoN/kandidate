/** Hash router: `#/applications/12?tab=analyse`. */

export interface Route {
  name: RouteName;
  params: Record<string, string>;
  query: URLSearchParams;
  path: string;
}

export type RouteName =
  | 'dashboard'
  | 'applications'
  | 'application'
  | 'offers'
  | 'offer'
  | 'analyze'
  | 'profile'
  | 'notifications'
  | 'settings'
  | 'notfound';

const TABLE: Array<[RegExp, RouteName, string[]]> = [
  [/^\/?$/, 'dashboard', []],
  [/^\/applications\/?$/, 'applications', []],
  [/^\/applications\/(\d+)\/?$/, 'application', ['id']],
  [/^\/offers\/?$/, 'offers', []],
  [/^\/offers\/(\d+)\/?$/, 'offer', ['id']],
  [/^\/analyze\/?$/, 'analyze', []],
  [/^\/profile\/?$/, 'profile', []],
  [/^\/notifications\/?$/, 'notifications', []],
  [/^\/settings\/?$/, 'settings', []],
];

export function parseRoute(hash = location.hash): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  for (const [re, name, keys] of TABLE) {
    const m = re.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { name, params, query: new URLSearchParams(qs ?? ''), path };
    }
  }
  return { name: 'notfound', params: {}, query: new URLSearchParams(qs ?? ''), path };
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const hash = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (opts.replace) history.replaceState(null, '', hash);
  else if (location.hash !== hash) location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Update the query string of the current route without adding history entries. */
export function setQuery(patch: Record<string, string | number | null | undefined>): void {
  const r = parseRoute();
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') r.query.delete(k);
    else r.query.set(k, String(v));
  }
  const qs = r.query.toString();
  history.replaceState(null, '', `#${r.path}${qs ? `?${qs}` : ''}`);
}

export const NAV: Array<{ route: RouteName; path: string; label: string; icon: string }> = [
  { route: 'dashboard', path: '/', label: 'Accueil', icon: 'space_dashboard' },
  { route: 'applications', path: '/applications', label: 'Candidatures', icon: 'work_history' },
  { route: 'offers', path: '/offers', label: 'Offres', icon: 'travel_explore' },
  { route: 'analyze', path: '/analyze', label: 'Analyse', icon: 'neurology' },
  { route: 'profile', path: '/profile', label: 'Profil', icon: 'badge' },
];
