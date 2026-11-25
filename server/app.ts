/**
 * API entry: `handle(request)` → `Response`. Used by the Vercel function
 * (api/handler.ts) and by the Vite dev server middleware.
 */
import { isAuthenticated } from './auth.js';
import { HttpError, json, makeCtx } from './http.js';
import { router } from './routes.js';

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Rewrites send /api/<path> to /api/handler?__p=<path>; the dev server keeps the original path.
  const fromRewrite = url.searchParams.get('__p');
  const path = `/${(fromRewrite ?? url.pathname.replace(/^\/api\/?/, '')).replace(/^\/+/, '')}`.replace(/\/+$/, '') || '/';
  if (fromRewrite !== null) {
    url.searchParams.delete('__p');
  }
  const method = req.method.toUpperCase();
  try {
    if (method === 'OPTIONS') return new Response(null, { status: 204 });
    const m = router.match(method, path);
    if (!m) throw new HttpError(404, `Route inconnue : ${method} ${path}`);
    if ('allowed' in m) throw new HttpError(405, 'Méthode non autorisée');
    if (!m.route.isPublic) {
      if (!(await isAuthenticated(req))) throw new HttpError(401, 'Authentification requise');
      // CSRF: mutating calls from the app always send JSON.
      if (method !== 'GET' && method !== 'HEAD' && !(req.headers.get('content-type') ?? '').includes('application/json')) {
        throw new HttpError(415, 'Content-Type application/json attendu');
      }
    }
    const ctx = makeCtx(fromRewrite !== null ? new Request(url, req) : req, path, m.params);
    const data = await m.route.handler(ctx);
    if (data instanceof Response) return data;
    return json(data ?? { ok: true }, 200, ctx.headers);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, details: e.details ?? null }, e.status);
    console.error('[api]', method, path, e);
    return json({ error: 'Erreur interne', details: process.env.NODE_ENV === 'production' ? null : String((e as Error)?.stack ?? e) }, 500);
  }
}
