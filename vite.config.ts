import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const root = __dirname;
const k3ui = resolve(root, 'vendor/k3ui/src');
const k3ux = resolve(root, 'vendor/k3ux/src');

/** Icons rendered inside k3ui components themselves (select arrow, dialog close, pickers…). */
const BASE_ICONS = [
  'add', 'apps', 'arrow_back', 'arrow_drop_down', 'arrow_forward', 'bookmark', 'calendar_today', 'check', 'check_circle',
  'chevron_left', 'chevron_right', 'close', 'content_copy', 'drag_indicator', 'edit', 'error', 'expand_more', 'info',
  'keyboard', 'menu', 'menu_open', 'remove', 'schedule', 'search', 'visibility', 'visibility_off', 'warning',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|html)$/.test(f)) out.push(p);
  }
  return out;
}

/**
 * Collect the Material Symbols the app uses → one Google Fonts subset request (names must be sorted).
 * Every quoted snake_case literal in src/ that is a real symbol name (scripts/material-symbols.txt) is kept,
 * so icons picked dynamically (maps, arrays) are covered too.
 */
function iconNames(): string[] {
  const known = new Set(readFileSync(resolve(root, 'scripts/material-symbols.txt'), 'utf8').split(/\r?\n/).filter(Boolean));
  const names = new Set(BASE_ICONS);
  const files = [...walk(resolve(root, 'src')), resolve(root, 'shared/types.ts')];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/['"`=]([a-z][a-z0-9_]{1,40})['"`]/g)) if (known.has(m[1])) names.add(m[1]);
  }
  return [...names].sort();
}

function materialSymbols(): Plugin {
  return {
    name: 'kandidate-material-symbols',
    transformIndexHtml(html) {
      const url = `https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400..700,0..1,0&icon_names=${iconNames().join(',')}&display=block`;
      return html.replace('%MATERIAL_SYMBOLS_URL%', url);
    },
  };
}

/** Serve /api/* from server/app.ts in dev (same code as the Vercel function). */
function apiDev(): Plugin {
  return {
    name: 'kandidate-api-dev',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/api/')) return next();
        try {
          const { handle } = (await server.ssrLoadModule('/server/app.ts')) as typeof import('./server/app');
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
            method: req.method,
            headers,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
          });
          const response = await handle(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => {
            if (k === 'set-cookie') return;
            res.setHeader(k, v);
          });
          const cookies = response.headers.getSetCookie?.() ?? [];
          if (cookies.length) res.setHeader('set-cookie', cookies);
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          server.ssrFixStacktrace(e as Error);
          console.error(e);
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: String((e as Error).message) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Server code reads process.env — expose .env / .env.local to it in dev.
  Object.assign(process.env, { ...loadEnv(mode, root, ''), ...process.env });
  return {
    root,
    plugins: [tailwindcss(), materialSymbols(), apiDev()],
    resolve: {
      dedupe: ['lit', 'lit-html', 'lit-element', '@lit/reactive-element'],
      alias: [
        { find: '@k3ui', replacement: k3ui },
        { find: '@k3ux', replacement: k3ux },
        /* k3ux imports `k3ui`: the lazy entry keeps a single K3UI instance and on-demand chunks. */
        { find: /^k3ui$/, replacement: resolve(k3ui, 'lazy.ts') },
      ],
    },
    optimizeDeps: {
      // Only the app entry: the vendor playgrounds (k3ui / k3ux) have their own HTML entries.
      entries: ['index.html'],
    },
    server: {
      port: 5173,
      host: true,
      fs: { allow: [root] },
    },
    build: {
      outDir: 'dist',
      target: 'es2022',
      sourcemap: false,
      cssMinify: true,
      chunkSizeWarningLimit: 900,
    },
    css: { preprocessorOptions: { scss: { api: 'modern-compiler' } } },
  };
});
