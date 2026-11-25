/** Tiny fetch-standard router (works on Vercel Functions and in the Vite dev server). */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface Ctx {
  req: Request;
  url: URL;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Lazily parsed JSON body (`{}` when empty). */
  body<T = Record<string, unknown>>(): Promise<T>;
  /** Raw text body (webhooks need it for signature checks). */
  text(): Promise<string>;
  /** Extra headers to attach to the response (cookies…). */
  headers: Headers;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
  isPublic: boolean;
}

export interface RouteOptions {
  /** Skip the session check (auth, health, cron with its own secret, webhooks). */
  public?: boolean;
}

export class Router {
  private routes: Route[] = [];

  on(method: string, pattern: string, handler: Handler, opts: RouteOptions = {}): this {
    const keys: string[] = [];
    const re = new RegExp(
      `^${pattern.replace(/\/:([a-zA-Z]+)/g, (_m, k: string) => {
        keys.push(k);
        return '/([^/]+)';
      })}/?$`,
    );
    this.routes.push({ method, re, keys, handler, isPublic: !!opts.public });
    return this;
  }
  get(p: string, h: Handler, o?: RouteOptions): this {
    return this.on('GET', p, h, o);
  }
  post(p: string, h: Handler, o?: RouteOptions): this {
    return this.on('POST', p, h, o);
  }
  put(p: string, h: Handler, o?: RouteOptions): this {
    return this.on('PUT', p, h, o);
  }
  patch(p: string, h: Handler, o?: RouteOptions): this {
    return this.on('PATCH', p, h, o);
  }
  delete(p: string, h: Handler, o?: RouteOptions): this {
    return this.on('DELETE', p, h, o);
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | { allowed: string[] } | null {
    const allowed: string[] = [];
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) {
        allowed.push(r.method);
        continue;
      }
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
    return allowed.length ? { allowed } : null;
  }
}

export function json(data: unknown, status = 200, headers?: Headers): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(status === 204 ? null : JSON.stringify(data), { status, headers: h });
}

export function makeCtx(req: Request, path: string, params: Record<string, string>): Ctx {
  const url = new URL(req.url);
  let textCache: Promise<string> | null = null;
  const text = (): Promise<string> => (textCache ??= req.text());
  return {
    req,
    url,
    path,
    params,
    query: url.searchParams,
    headers: new Headers(),
    text,
    async body<T>() {
      const t = await text();
      if (!t) return {} as T;
      try {
        return JSON.parse(t) as T;
      } catch {
        throw new HttpError(400, 'Corps JSON invalide');
      }
    },
  };
}

export function intParam(v: string | null | undefined, def: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = v == null || v === '' ? def : Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

export function requireId(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Identifiant invalide');
  return n;
}

export function str(v: unknown, max = 20000): string {
  if (v == null) return '';
  return String(v).slice(0, max);
}
