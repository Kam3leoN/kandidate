import { db } from './db.js';
import { mapApplication } from './repo/applications.js';
import { mapOffer } from './repo/offers.js';
import { getSettings } from './repo/profile.js';

export async function dashboardStats(): Promise<Record<string, unknown>> {
  const d = await db();
  const settings = await getSettings();
  const [byStatusRows, totalsRows, weeklyApps, weeklyOffers, due, interviews, topOffers, sources, lastRun] = await Promise.all([
    d.query<{ status: string; n: number }>('select status, count(*)::int as n from applications group by status'),
    d.query<{ sent: number; answered: number; interviews: number; avg_score: number | null; offers_new: number; offers_week: number }>(
      `select
        (select count(*)::int from applications where applied_at is not null) as sent,
        (select count(*)::int from applications where applied_at is not null and status in ('interview','offer','hired','rejected')) as answered,
        (select count(*)::int from applications where status in ('interview','offer','hired') or exists (select 1 from application_events e where e.application_id = applications.id and e.type = 'interview')) as interviews,
        (select round(avg(match_score))::int from applications where match_score is not null) as avg_score,
        (select count(*)::int from offers where status = 'new') as offers_new,
        (select count(*)::int from offers where fetched_at > now() - interval '7 days' and coalesce(match_score,0) >= $1) as offers_week`,
      [settings.matchThreshold],
    ),
    d.query<{ wk: string; n: number }>(
      `select to_char(date_trunc('week', applied_at), 'YYYY-MM-DD') as wk, count(*)::int as n from applications
       where applied_at > now() - interval '12 weeks' group by 1 order by 1`,
    ),
    d.query<{ wk: string; n: number }>(
      `select to_char(date_trunc('week', fetched_at), 'YYYY-MM-DD') as wk, count(*)::int as n from offers
       where fetched_at > now() - interval '12 weeks' and coalesce(match_score,0) >= $1 group by 1 order by 1`,
      [settings.matchThreshold],
    ),
    d.query(
      `select a.*, null as last_event_at, null as next_interview_at from applications a
       where next_followup_at is not null and next_followup_at <= now() + interval '7 days' and status in ('applied','followup','interview')
       order by next_followup_at limit 8`,
    ),
    d.query<{ id: number; application_id: number; at: string; title: string; app_title: string; company: string }>(
      `select e.id, e.application_id, e.at, e.title, a.title as app_title, a.company from application_events e
       join applications a on a.id = e.application_id where e.type = 'interview' and e.at >= now() - interval '2 hours' order by e.at limit 6`,
    ),
    d.query(`select o.*, null as application_id from offers o where status in ('new','seen') and fetched_at > now() - interval '14 days' order by match_score desc nulls last limit 6`),
    d.query<{ source: string; n: number }>(`select source, count(*)::int as n from offers where fetched_at > now() - interval '30 days' group by source order by n desc`),
    d.query<{ started_at: string; finished_at: string | null; trigger: string; error: string | null }>('select started_at, finished_at, trigger, error from cron_runs order by id desc limit 1'),
  ]);
  const t = totalsRows[0];
  // 12 ISO weeks, oldest first, with zeros.
  const weeks: string[] = [];
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  for (let i = 11; i >= 0; i--) {
    const w = new Date(monday);
    w.setDate(w.getDate() - i * 7);
    weeks.push(`${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, '0')}-${String(w.getDate()).padStart(2, '0')}`);
  }
  const series = (rows: Array<{ wk: string; n: number }>): number[] => weeks.map((w) => rows.find((r) => r.wk === w)?.n ?? 0);
  return {
    byStatus: Object.fromEntries(byStatusRows.map((r) => [r.status, r.n])),
    sent: t.sent,
    responseRate: t.sent ? Math.round((t.answered / t.sent) * 100) : null,
    interviewRate: t.sent ? Math.round((t.interviews / t.sent) * 100) : null,
    avgScore: t.avg_score,
    offersNew: t.offers_new,
    offersWeek: t.offers_week,
    weeks,
    weeklyApplications: series(weeklyApps),
    weeklyMatches: series(weeklyOffers),
    followupsDue: due.map(mapApplication),
    interviews: interviews.map((e) => ({ id: e.id, applicationId: e.application_id, at: new Date(e.at).toISOString(), title: e.title, appTitle: e.app_title, company: e.company })),
    topOffers: topOffers.map((o) => mapOffer(o)),
    sources: sources,
    lastRun: lastRun[0] ? { ...lastRun[0], started_at: new Date(lastRun[0].started_at).toISOString() } : null,
    threshold: settings.matchThreshold,
  };
}
