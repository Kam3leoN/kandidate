/**
 * Daily watch (Vercel Cron or any scheduler hitting /api/cron/run):
 *  1. run every saved search with alerts on → store new offers → notify good matches
 *  2. follow-ups due → reminder
 *  3. interviews in the next 26 h → reminder
 *  4. email digest of everything not emailed yet
 */
import type { Profile, SavedSearch, Settings } from '../shared/types.js';
import { db } from './db.js';
import { appUrl, emailConfigured, notify, renderDigest, sendEmail } from './notify.js';
import { deleteOldOffers, upsertOffers } from './repo/offers.js';
import { getProfile, getSettings } from './repo/profile.js';
import { markEmailed, pendingForDigest, pruneNotifications } from './repo/notifications.js';
import { listSearches, markSearchRun } from './repo/searches.js';
import { runSearch } from './sources/index.js';

export interface SearchRunStats {
  searchId: number;
  name: string;
  fetched: number;
  inserted: number;
  matches: number;
  errors: Array<{ source: string; message: string }>;
}

const fmtDate = (d: string | Date): string => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const fmtTime = (d: string | Date): string => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: process.env.APP_TIMEZONE || 'Europe/Paris' });

export async function runSavedSearch(s: SavedSearch, profile: Profile, settings: Settings, opts: { notify?: boolean } = {}): Promise<SearchRunStats> {
  const result = await runSearch(
    {
      keywords: s.keywords,
      location: s.location,
      radiusKm: s.radiusKm,
      contracts: s.contracts,
      remote: s.remote,
      salaryMin: s.salaryMin,
      publishedSinceDays: s.publishedSinceDays,
      romeCodes: s.romeCodes,
      excludeKeywords: [...s.excludeKeywords, ...profile.excludedKeywords],
      limit: 50,
    },
    s.sources,
    profile,
  );
  const stored = await upsertOffers(result.offers, profile, { searchId: s.id });
  const threshold = Math.max(s.minScore, 0) || settings.matchThreshold;
  const good = stored.inserted.filter((o) => (o.matchScore ?? 0) >= threshold).sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
  await markSearchRun(s.id, stored.inserted.length);
  if (good.length && opts.notify !== false && settings.notifyInApp) {
    await notify({
      kind: 'offer_match',
      title: `${good.length} nouvelle${good.length > 1 ? 's' : ''} offre${good.length > 1 ? 's' : ''} pour « ${s.name} »`,
      body: good
        .slice(0, 3)
        .map((o) => `${o.matchScore} % · ${o.title}${o.company ? ` — ${o.company}` : ''}${o.location ? ` (${o.location})` : ''}`)
        .join('\n') + (good.length > 3 ? `\n+ ${good.length - 3} autre(s)` : ''),
      url: `/offers?search=${s.id}`,
      meta: { searchId: s.id, offerIds: good.map((o) => o.id) },
    });
  }
  return { searchId: s.id, name: s.name, fetched: result.offers.length, inserted: stored.inserted.length, matches: good.length, errors: result.errors };
}

export async function checkFollowups(): Promise<number> {
  const d = await db();
  const rows = await d.query<{ id: number; title: string; company: string; applied_at: string | null; followup_count: number; status: string; next_followup_at: string }>(
    `select id, title, company, applied_at, followup_count, status, next_followup_at from applications
     where next_followup_at is not null and next_followup_at <= now() + interval '2 hours'
       and status in ('applied','followup','interview')
       and (followup_notified_at is null or followup_notified_at < next_followup_at)
     order by next_followup_at limit 50`,
  );
  for (const a of rows) {
    const post = a.status === 'interview';
    await notify({
      kind: 'followup_due',
      title: post ? `Relance post-entretien : ${a.title}` : `Relance à faire : ${a.title}`,
      body: [a.company, a.applied_at ? `envoyée le ${fmtDate(a.applied_at)}` : '', post ? 'remerciement / demande de retour' : `relance n°${a.followup_count + 1}`].filter(Boolean).join(' · '),
      url: `/applications/${a.id}`,
      meta: { applicationId: a.id },
    });
    await d.query('update applications set followup_notified_at = now() where id = $1', [a.id]);
  }
  return rows.length;
}

export async function checkInterviews(): Promise<number> {
  const d = await db();
  const rows = await d.query<{ id: number; application_id: number; at: string; title: string; app_title: string; company: string; meta: Record<string, unknown> }>(
    `select e.id, e.application_id, e.at, e.title, a.title as app_title, a.company, e.meta from application_events e
     join applications a on a.id = e.application_id
     where e.type = 'interview' and e.at between now() and now() + interval '26 hours' and coalesce((e.meta->>'notified')::boolean, false) = false`,
  );
  for (const e of rows) {
    const today = new Date(e.at).toDateString() === new Date().toDateString();
    await notify({
      kind: 'interview_soon',
      title: `${e.title || 'Entretien'} ${today ? 'aujourd’hui' : 'demain'} à ${fmtTime(e.at)}`,
      body: `${e.app_title}${e.company ? ` — ${e.company}` : ''}${e.meta?.location ? `\n${e.meta.location}` : ''}`,
      url: `/applications/${e.application_id}`,
      meta: { applicationId: e.application_id, eventId: e.id },
    });
    await d.query(`update application_events set meta = meta || '{"notified": true}'::jsonb where id = $1`, [e.id]);
  }
  return rows.length;
}

export async function sendDigest(settings: Settings, force = false): Promise<number> {
  if (!settings.notifyEmail || !settings.emailTo || !emailConfigured()) return 0;
  const items = await pendingForDigest();
  if (!items.length && (settings.digestOnlyIfNew || !force)) return 0;
  const mail = renderDigest(items, settings.seedColor);
  await sendEmail({ to: settings.emailTo, ...mail });
  await markEmailed(items.map((i) => i.id));
  return items.length;
}

export async function runCron(trigger: string): Promise<Record<string, unknown>> {
  const d = await db();
  const [run] = await d.query<{ id: number }>('insert into cron_runs (trigger) values ($1) returning id', [trigger]);
  const stats: Record<string, unknown> = { appUrl: appUrl() };
  try {
    const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
    const searches = (await listSearches()).filter((s) => s.alert);
    const results: SearchRunStats[] = [];
    for (const s of searches) {
      try {
        results.push(await runSavedSearch(s, profile, settings));
      } catch (e) {
        results.push({ searchId: s.id, name: s.name, fetched: 0, inserted: 0, matches: 0, errors: [{ source: 'all', message: (e as Error).message }] });
      }
    }
    stats.searches = results;
    stats.followups = await checkFollowups();
    stats.interviews = await checkInterviews();
    stats.emailed = await sendDigest(settings).catch((e) => {
      stats.emailError = (e as Error).message;
      return 0;
    });
    stats.cleaned = await deleteOldOffers(75);
    await pruneNotifications();
    await d.query('update cron_runs set finished_at = now(), stats = $1::jsonb where id = $2', [JSON.stringify(stats), run.id]);
    return stats;
  } catch (e) {
    await d.query('update cron_runs set finished_at = now(), stats = $1::jsonb, error = $2 where id = $3', [JSON.stringify(stats), (e as Error).message, run.id]);
    throw e;
  }
}
