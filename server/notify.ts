/**
 * Notification fan-out: in-app center (DB) → Web Push (VAPID) → email digest (Resend).
 */
import webpush from 'web-push';
import type { AppNotification, NotificationKind, Settings } from '../shared/types.js';
import { db } from './db.js';
import { getSettings } from './repo/profile.js';
import { insertNotification } from './repo/notifications.js';

export function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

let vapidReady = false;
function ensureVapid(settings?: Settings): boolean {
  if (!pushConfigured()) return false;
  if (!vapidReady) {
    const subject = process.env.VAPID_SUBJECT || `mailto:${settings?.emailTo || 'kandidate@example.com'}`;
    webpush.setVapidDetails(subject, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    vapidReady = true;
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export async function sendPushToAll(payload: PushPayload, settings?: Settings): Promise<{ sent: number; removed: number }> {
  if (!ensureVapid(settings)) return { sent: 0, removed: 0 };
  const d = await db();
  const subs = await d.query<{ id: number; endpoint: string; p256dh: string; auth: string }>('select id, endpoint, p256dh, auth from push_subscriptions');
  let sent = 0;
  let removed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 12, urgency: 'normal' });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await d.query('delete from push_subscriptions where id = $1', [s.id]);
          removed++;
        } else console.warn('[push]', status, (e as Error).message);
      }
    }),
  );
  return { sent, removed };
}

/** Create an in-app notification and push it right away when enabled. */
export async function notify(n: { kind: NotificationKind; title: string; body?: string; url?: string; meta?: Record<string, unknown> }): Promise<AppNotification> {
  const settings = await getSettings();
  const saved = await insertNotification(n);
  if (settings.notifyPush) {
    await sendPushToAll({ title: n.title, body: n.body ?? '', url: n.url ? `/#${n.url}` : '/', tag: `${n.kind}-${saved.id}` }, settings).catch((e) => console.warn('[push]', e));
  }
  return saved;
}

export async function sendEmail(msg: { to: string; subject: string; html: string; text: string }): Promise<string | null> {
  if (!emailConfigured()) throw new Error('RESEND_API_KEY manquant');
  const from = process.env.EMAIL_FROM || 'KandiDate <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) throw new Error(`Resend ${res.status} : ${j.message ?? 'erreur'}`);
  return j.id ?? null;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function appUrl(): string {
  return (process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:5173')).replace(/\/$/, '');
}

/** HTML digest grouped by kind, Material-ish but email-safe (tables + inline styles). */
export function renderDigest(items: AppNotification[], seed = '#6750A4'): { subject: string; html: string; text: string } {
  const groups: Array<[NotificationKind[], string]> = [
    [['followup_due', 'interview_soon'], 'À faire aujourd’hui'],
    [['offer_match', 'import'], 'Nouvelles offres pour toi'],
    [['system'], 'Divers'],
  ];
  const base = appUrl();
  const sections = groups
    .map(([kinds, label]) => {
      const list = items.filter((i) => kinds.includes(i.kind));
      if (!list.length) return '';
      const rows = list
        .map(
          (i) => `<tr><td style="padding:12px 16px;border-radius:16px;background:#f7f2fa">
            <a href="${base}/#${esc(i.url || '/')}" style="color:#1d1b20;text-decoration:none;font:600 15px/1.35 'Google Sans',Roboto,Arial,sans-serif">${esc(i.title)}</a>
            <div style="color:#49454f;font:400 14px/1.45 Roboto,Arial,sans-serif;margin-top:4px;white-space:pre-line">${esc(i.body)}</div>
          </td></tr><tr><td style="height:8px"></td></tr>`,
        )
        .join('');
      return `<h2 style="font:500 18px/1.3 'Google Sans',Roboto,Arial,sans-serif;color:${seed};margin:24px 0 12px">${label}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>`;
    })
    .join('');
  const due = items.filter((i) => i.kind === 'followup_due').length;
  const offers = items.filter((i) => i.kind === 'offer_match' || i.kind === 'import').length;
  const subject = [due ? `${due} relance${due > 1 ? 's' : ''} à faire` : '', offers ? `${offers} alerte${offers > 1 ? 's' : ''} offres` : ''].filter(Boolean).join(' · ') || 'Ton récap KandiDate';
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#fef7ff;padding:24px">
    <table role="presentation" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:28px;padding:28px" cellspacing="0" cellpadding="0"><tr><td>
      <div style="font:700 26px/1.2 'Google Sans',Roboto,Arial,sans-serif;color:#1d1b20">Kandi<span style="color:${seed}">Date</span></div>
      <div style="font:400 14px/1.4 Roboto,Arial,sans-serif;color:#49454f;margin-top:4px">Récapitulatif du ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      ${sections}
      <div style="margin-top:28px"><a href="${base}/" style="display:inline-block;background:${seed};color:#fff;border-radius:999px;padding:12px 24px;font:500 14px 'Google Sans',Roboto,Arial,sans-serif;text-decoration:none">Ouvrir KandiDate</a></div>
      <div style="font:400 12px/1.4 Roboto,Arial,sans-serif;color:#79747e;margin-top:24px">Tu reçois cet email car le récap est activé dans Paramètres → Notifications.</div>
    </td></tr></table></body></html>`;
  const text = `${subject}\n\n${items.map((i) => `• ${i.title}\n  ${i.body.replace(/\n/g, '\n  ')}\n  ${base}/#${i.url}`).join('\n\n')}\n\n${base}/`;
  return { subject: `KandiDate — ${subject}`, html, text };
}
