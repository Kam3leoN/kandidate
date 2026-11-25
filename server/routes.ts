import { scoreOffer } from '../shared/analysis/index.js';
import type { Application, NormalizedOffer, Offer, Profile, SavedSearch, Settings, SourceId } from '../shared/types.js';
import { authRequired, checkCronSecret, isAuthenticated, login, logout, verifySvix } from './auth.js';
import { runCron, runSavedSearch, sendDigest } from './cron.js';
import { db } from './db.js';
import { HttpError, intParam, requireId, Router, str } from './http.js';
import { parseAlertEmail } from './importers/email-alert.js';
import { importFromText, importFromUrl } from './importers/url.js';
import { emailConfigured, notify, pushConfigured, renderDigest, sendEmail, sendPushToAll } from './notify.js';
import * as apps from './repo/applications.js';
import { deleteNotification, listNotifications, markRead } from './repo/notifications.js';
import { annotateKnown, bulkOfferStatus, getOffer, listOffers, rescoreAll, saveOffer, setOfferStatus, upsertOffers } from './repo/offers.js';
import { getProfile, getSettings, saveProfile, saveSettings } from './repo/profile.js';
import * as searches from './repo/searches.js';
import { runSearch, searchCommunes, sourceStatuses } from './sources/index.js';
import { dashboardStats } from './stats.js';

export const router = new Router();

/* ───────── System / auth ───────── */

router.get('/health', async () => ({ ok: true, db: (await db()).kind }), { public: true });

router.get('/auth/me', async ({ req }) => ({ authenticated: await isAuthenticated(req), authRequired: authRequired() }), { public: true });
router.post('/auth/login', login, { public: true });
router.post('/auth/logout', logout, { public: true });

router.get('/system', async () => {
  const d = await db();
  const runs = await d.query('select id, trigger, started_at, finished_at, stats, error from cron_runs order by id desc limit 5');
  return {
    db: d.kind,
    authRequired: authRequired(),
    sources: sourceStatuses(),
    push: { configured: pushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY ?? null },
    email: { configured: emailConfigured(), from: process.env.EMAIL_FROM ?? null },
    inbound: {
      resend: !!process.env.RESEND_WEBHOOK_SECRET,
      generic: !!process.env.INBOUND_TOKEN,
      address: process.env.INBOUND_ADDRESS ?? null,
    },
    cron: { secret: !!process.env.CRON_SECRET, runs },
  };
});

/* ───────── Profile & settings ───────── */

router.get('/profile', () => getProfile());
router.put('/profile', async (ctx) => {
  const saved = await saveProfile(await ctx.body<Partial<Profile>>());
  const rescored = await rescoreAll(saved);
  return { profile: saved, rescored };
});
router.get('/settings', () => getSettings());
router.put('/settings', async (ctx) => saveSettings(await ctx.body<Partial<Settings>>()));

/* ───────── Dashboard ───────── */

router.get('/stats', () => dashboardStats());

/* ───────── Applications ───────── */

router.get('/applications', ({ query }) => apps.listApplications({ status: query.get('status') ?? undefined, q: query.get('q') ?? undefined }));
router.post('/applications', async (ctx) => apps.createApplication(await ctx.body<Partial<Application>>()));
router.get('/applications/:id', ({ params }) => apps.getApplication(requireId(params.id)));
router.patch('/applications/:id', async (ctx) => apps.updateApplication(requireId(ctx.params.id), await ctx.body<Partial<Application>>()));
router.delete('/applications/:id', async ({ params }) => {
  await apps.deleteApplication(requireId(params.id));
  return { ok: true };
});
router.post('/applications/:id/events', async (ctx) => {
  const id = requireId(ctx.params.id);
  const b = await ctx.body<{ type?: string; title?: string; body?: string; at?: string; location?: string }>();
  if (b.type === 'interview') return apps.scheduleInterview(id, { at: b.at ?? '', title: b.title, body: b.body, location: b.location });
  const type = (['note', 'email', 'call', 'reminder'] as const).find((t) => t === b.type) ?? 'note';
  return apps.addEvent(id, { type, title: str(b.title, 300) || 'Note', body: b.body, at: b.at });
});
router.delete('/applications/:id/events/:eventId', async ({ params }) => {
  await apps.deleteEvent(requireId(params.id), requireId(params.eventId));
  return { ok: true };
});
router.post('/applications/:id/followup', async (ctx) => apps.logFollowup(requireId(ctx.params.id), await ctx.body()));
router.post('/applications/:id/snooze', async (ctx) => {
  const { days } = await ctx.body<{ days?: number }>();
  const next = new Date(Date.now() + Math.max(1, Math.min(60, Number(days) || 3)) * 86400_000);
  next.setHours(9, 0, 0, 0);
  return apps.updateApplication(requireId(ctx.params.id), { nextFollowupAt: next.toISOString() });
});

/* ───────── Offers ───────── */

router.get('/offers', ({ query }) =>
  listOffers({
    status: query.get('status') ?? 'inbox',
    source: query.get('source') ?? undefined,
    q: query.get('q') ?? undefined,
    minScore: intParam(query.get('minScore'), 0, 0, 100),
    contract: query.get('contract') ?? undefined,
    remote: query.get('remote') ?? undefined,
    searchId: intParam(query.get('search'), 0) || undefined,
    sinceDays: intParam(query.get('since'), 0, 0, 365) || undefined,
    sort: query.get('sort') === 'date' ? 'date' : 'score',
    limit: intParam(query.get('limit'), 30, 1, 100),
    offset: intParam(query.get('offset'), 0, 0),
  }),
);
router.get('/offers/:id', async ({ params }) => getOffer(requireId(params.id), await getProfile()));
router.patch('/offers/:id', async (ctx) => {
  const { status } = await ctx.body<{ status: Offer['status'] }>();
  await setOfferStatus(requireId(ctx.params.id), status);
  return { ok: true };
});
router.post('/offers/bulk', async (ctx) => {
  const { ids, status } = await ctx.body<{ ids: number[]; status: Offer['status'] }>();
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Aucune offre');
  await bulkOfferStatus(ids.map(Number).filter(Number.isInteger), status);
  return { ok: true };
});
/** Store a live-search / imported offer. */
router.post('/offers', async (ctx) => {
  const b = await ctx.body<{ offer: NormalizedOffer; status?: Offer['status'] }>();
  if (!b.offer?.title || !b.offer.source) throw new HttpError(400, 'Offre invalide');
  const id = await saveOffer(b.offer, await getProfile(), b.status ?? 'saved');
  return getOffer(id, await getProfile());
});
router.post('/offers/:id/apply', async (ctx) => {
  const id = requireId(ctx.params.id);
  const { status } = await ctx.body<{ status?: Application['status'] }>();
  const offer = await getOffer(id, await getProfile());
  if (offer.applicationId) return (await apps.getApplication(offer.applicationId)).application;
  return apps.createApplication({
    offerId: id,
    title: offer.title,
    company: offer.company,
    location: offer.location,
    url: offer.url,
    source: offer.source,
    contract: offer.contract,
    salaryText: offer.salaryText,
    matchScore: offer.matchScore,
    description: offer.description,
    status: status ?? 'wishlist',
  });
});

/** Live multi-source search (not stored). */
router.post('/search', async (ctx) => {
  const b = await ctx.body<Partial<SavedSearch> & { sources?: SourceId[] }>();
  const s = searches.sanitizeSearch(b);
  if (!s.keywords && !s.romeCodes.length) throw new HttpError(400, 'Saisis au moins un mot-clé');
  const profile = await getProfile();
  const r = await runSearch({ ...s, excludeKeywords: [...s.excludeKeywords, ...profile.excludedKeywords], limit: 40 }, s.sources, profile);
  return { ...r, offers: await annotateKnown(r.offers) };
});

/* ───────── Saved searches (alerts) ───────── */

router.get('/searches', () => searches.listSearches());
router.post('/searches', async (ctx) => searches.createSearch(await ctx.body()));
router.patch('/searches/:id', async (ctx) => searches.updateSearch(requireId(ctx.params.id), await ctx.body()));
router.delete('/searches/:id', async ({ params }) => {
  await searches.deleteSearch(requireId(params.id));
  return { ok: true };
});
router.post('/searches/:id/run', async ({ params }) => {
  const s = await searches.getSearch(requireId(params.id));
  return runSavedSearch(s, await getProfile(), await getSettings());
});

/* ───────── Analysis & import ───────── */

router.post('/analyze', async (ctx) => {
  const b = await ctx.body<{ text?: string; url?: string; title?: string; company?: string }>();
  let offer: NormalizedOffer;
  if (b.text && b.text.trim().length >= 40) offer = importFromText(b.text, { title: b.title, company: b.company, url: b.url });
  else if (b.url) offer = await importFromUrl(b.url);
  else throw new HttpError(400, 'Colle le texte de l’annonce ou son URL');
  const { analysis, match } = scoreOffer(offer, await getProfile());
  const filled: NormalizedOffer = {
    ...offer,
    title: b.title || (offer.source === 'import' && b.text ? analysis.title || offer.title : offer.title),
    company: offer.company || analysis.company,
    location: offer.location || analysis.location,
    contract: offer.contract ?? analysis.contract,
    remote: offer.remote ?? analysis.remote,
    salaryText: offer.salaryText || analysis.salary?.text || '',
    matchScore: match.score,
  };
  const [known] = await annotateKnown([filled]);
  return { offer: known, analysis, match };
});

/* ───────── Notifications ───────── */

router.get('/notifications', ({ query }) => listNotifications({ unread: query.get('unread') === '1', limit: intParam(query.get('limit'), 50, 1, 200) }));
router.post('/notifications/read', async (ctx) => {
  const { ids } = await ctx.body<{ ids?: number[] | 'all' }>();
  await markRead(ids === 'all' || !ids ? 'all' : ids.map(Number));
  return { ok: true };
});
router.delete('/notifications/:id', async ({ params }) => {
  await deleteNotification(requireId(params.id));
  return { ok: true };
});

/* ───────── Web Push ───────── */

router.get('/push/key', () => ({ configured: pushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY ?? null }));
router.post('/push/subscribe', async (ctx) => {
  const b = await ctx.body<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>();
  if (!b.endpoint || !/^https:\/\//.test(b.endpoint) || !b.keys?.p256dh || !b.keys.auth) throw new HttpError(400, 'Abonnement push invalide');
  const d = await db();
  await d.query(
    `insert into push_subscriptions (endpoint, p256dh, auth, user_agent) values ($1,$2,$3,$4)
     on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth`,
    [b.endpoint, b.keys.p256dh, b.keys.auth, str(ctx.req.headers.get('user-agent'), 300)],
  );
  return { ok: true };
});
router.post('/push/unsubscribe', async (ctx) => {
  const { endpoint } = await ctx.body<{ endpoint?: string }>();
  const d = await db();
  await d.query('delete from push_subscriptions where endpoint = $1', [endpoint ?? '']);
  return { ok: true };
});
router.post('/push/test', async () => {
  if (!pushConfigured()) throw new HttpError(400, 'Clés VAPID absentes côté serveur');
  return sendPushToAll({ title: 'KandiDate', body: 'Les notifications push fonctionnent 🎉', url: '/#/notifications', tag: 'test' }, await getSettings());
});

/* ───────── Email ───────── */

router.post('/email/test', async () => {
  const settings = await getSettings();
  if (!settings.emailTo) throw new HttpError(400, 'Renseigne ton adresse email dans les paramètres');
  if (!emailConfigured()) throw new HttpError(400, 'RESEND_API_KEY absent côté serveur');
  const n = await listNotifications({ limit: 6 });
  const mail = renderDigest(n.items.length ? n.items : [{ id: 0, kind: 'system', title: 'Test d’envoi', body: 'Ton récap email est bien configuré.', url: '/', readAt: null, createdAt: new Date().toISOString(), meta: {} }], settings.seedColor);
  return { id: await sendEmail({ to: settings.emailTo, ...mail }) };
});
router.post('/email/digest', async () => ({ sent: await sendDigest(await getSettings(), true) }));

/* ───────── Geo autocomplete ───────── */

router.get('/geo', ({ query }) => searchCommunes(query.get('q') ?? ''));

/* ───────── Watch (cron) ───────── */

router.get('/cron/run', async (ctx) => {
  checkCronSecret(ctx);
  return runCron(ctx.req.headers.get('user-agent')?.includes('vercel-cron') ? 'vercel-cron' : 'external');
}, { public: true });
router.post('/cron/run', async (ctx) => {
  checkCronSecret(ctx);
  return runCron('external');
}, { public: true });
router.post('/watch/run', () => runCron('manual'));

/* ───────── Inbound email (job alerts forwarded by the user) ───────── */

async function ingestAlert(mail: { html?: string | null; text?: string | null; subject?: string; from?: string; providerId?: string }): Promise<{ found: number; inserted: number }> {
  const parsed = parseAlertEmail(mail);
  const profile = await getProfile();
  const res = await upsertOffers(parsed.offers, profile);
  const d = await db();
  await d.query('insert into inbound_emails (provider_id, sender, subject, offers_found) values ($1,$2,$3,$4)', [mail.providerId ?? null, str(mail.from, 300), str(mail.subject, 300), parsed.offers.length]);
  if (res.inserted.length) {
    const top = [...res.inserted].sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
    await notify({
      kind: 'import',
      title: `${res.inserted.length} offre${res.inserted.length > 1 ? 's' : ''} importée${res.inserted.length > 1 ? 's' : ''} depuis ${parsed.provider}`,
      body: top
        .slice(0, 3)
        .map((o) => `${o.matchScore ?? '–'} % · ${o.title}${o.company ? ` — ${o.company}` : ''}`)
        .join('\n'),
      url: '/offers?source=email',
      meta: { offerIds: res.inserted.map((o) => o.id), provider: parsed.provider },
    });
  }
  return { found: parsed.offers.length, inserted: res.inserted.length };
}

router.post('/inbound/resend', async (ctx) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const raw = await ctx.text();
  if (!secret || !(await verifySvix(ctx.req, raw, secret))) throw new HttpError(401, 'Signature invalide');
  const evt = JSON.parse(raw) as { type?: string; data?: { email_id?: string; from?: string; subject?: string } };
  if (evt.type !== 'email.received' || !evt.data?.email_id) return { ignored: true };
  const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(evt.data.email_id)}`, {
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new HttpError(502, `Lecture de l’email impossible (Resend ${r.status})`);
  const mail = (await r.json()) as { html?: string; text?: string; subject?: string; from?: string };
  return ingestAlert({ ...mail, providerId: evt.data.email_id });
}, { public: true });

/** Generic inbound (Postmark, Cloudflare Email Workers, Make/Zapier…): `?token=INBOUND_TOKEN`. */
router.post('/inbound/email', async (ctx) => {
  const token = process.env.INBOUND_TOKEN;
  if (!token || ctx.query.get('token') !== token) throw new HttpError(401, 'Jeton invalide');
  const b = await ctx.body<Record<string, string>>();
  return ingestAlert({
    html: b.html ?? b.HtmlBody ?? b['body-html'] ?? null,
    text: b.text ?? b.TextBody ?? b['body-plain'] ?? null,
    subject: b.subject ?? b.Subject ?? '',
    from: b.from ?? b.From ?? '',
  });
}, { public: true });

/** Same parser from the UI: paste the content of an alert email. */
router.post('/inbound/paste', async (ctx) => {
  const b = await ctx.body<{ html?: string; text?: string; subject?: string; from?: string }>();
  if (!b.html && !b.text) throw new HttpError(400, 'Colle le contenu de l’email');
  return ingestAlert(b);
});
