/**
 * Single-user auth: a password from `APP_PASSWORD` and a signed, HttpOnly
 * session cookie (HMAC-SHA256 with `SESSION_SECRET`). No password set → open
 * access (local development only — the UI shows a warning).
 */
import { HttpError, type Ctx } from './http.js';

const COOKIE = 'kd_session';
const MAX_AGE_S = 60 * 60 * 24 * 30;

const enc = new TextEncoder();

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(data: string): Promise<string> {
  const secret = process.env.SESSION_SECRET || process.env.APP_PASSWORD || 'kandidate-dev';
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function authRequired(): boolean {
  return !!process.env.APP_PASSWORD;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export async function isAuthenticated(req: Request): Promise<boolean> {
  if (!authRequired()) return true;
  const v = readCookie(req, COOKIE);
  if (!v) return false;
  const [exp, sig] = v.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return timingSafeEqual(sig, await hmac(`v1.${exp}`));
}

function cookieAttrs(req: Request): string {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export async function login(ctx: Ctx): Promise<{ ok: true }> {
  const { password } = await ctx.body<{ password?: string }>();
  const expected = process.env.APP_PASSWORD ?? '';
  if (!expected) return { ok: true };
  if (!password || !timingSafeEqual(await hmac(`pw:${password}`), await hmac(`pw:${expected}`))) {
    await new Promise((r) => setTimeout(r, 600));
    throw new HttpError(401, 'Mot de passe incorrect');
  }
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  ctx.headers.append('set-cookie', `${COOKIE}=${exp}.${await hmac(`v1.${exp}`)}; Max-Age=${MAX_AGE_S}; ${cookieAttrs(ctx.req)}`);
  return { ok: true };
}

export function logout(ctx: Ctx): { ok: true } {
  ctx.headers.append('set-cookie', `${COOKIE}=; Max-Age=0; ${cookieAttrs(ctx.req)}`);
  return { ok: true };
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; external schedulers may use `?secret=`. */
export function checkCronSecret(ctx: Ctx): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.VERCEL_ENV === 'production') throw new HttpError(401, 'CRON_SECRET non configuré');
    return;
  }
  const bearer = ctx.req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const q = ctx.query.get('secret') ?? '';
  if (!timingSafeEqual(bearer, secret) && !timingSafeEqual(q, secret)) throw new HttpError(401, 'Secret cron invalide');
}

/** Svix signature used by Resend webhooks (`svix-id`, `svix-timestamp`, `svix-signature`). */
export async function verifySvix(req: Request, payload: string, secret: string): Promise<boolean> {
  const id = req.headers.get('svix-id') ?? req.headers.get('webhook-id');
  const ts = req.headers.get('svix-timestamp') ?? req.headers.get('webhook-timestamp');
  const sigs = req.headers.get('svix-signature') ?? req.headers.get('webhook-signature');
  if (!id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 10) return false;
  const raw = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${id}.${ts}.${payload}`));
  let s = '';
  for (const b of new Uint8Array(sig)) s += String.fromCharCode(b);
  const expected = btoa(s);
  return sigs.split(' ').some((part) => {
    const [, value] = part.split(',');
    return !!value && timingSafeEqual(value, expected);
  });
}
