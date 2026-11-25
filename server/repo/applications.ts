import { APP_STATUSES, type AppEvent, type AppStatus, type Application, type EventType } from '../../shared/types.js';
import { db } from '../db.js';
import { HttpError, str } from '../http.js';
import { getSettings } from './profile.js';

type Row = Record<string, any>;

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export function mapApplication(r: Row): Application {
  return {
    id: r.id,
    offerId: r.offer_id ?? null,
    title: r.title,
    company: r.company,
    location: r.location,
    url: r.url,
    source: r.source ?? null,
    contract: r.contract ?? null,
    salaryText: r.salary_text,
    status: r.status,
    priority: r.priority,
    matchScore: r.match_score ?? null,
    appliedAt: iso(r.applied_at),
    nextFollowupAt: iso(r.next_followup_at),
    followupCount: r.followup_count,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    contactRole: r.contact_role,
    notes: r.notes,
    coverLetter: r.cover_letter,
    description: r.description,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    lastEventAt: iso(r.last_event_at),
    nextInterviewAt: iso(r.next_interview_at),
  };
}

export function mapEvent(r: Row): AppEvent {
  return { id: r.id, applicationId: r.application_id, type: r.type, title: r.title, body: r.body, at: iso(r.at)!, meta: r.meta ?? {} };
}

const STATUS_IDS = APP_STATUSES.map((s) => s.id);
const OPEN_FOLLOWUP: AppStatus[] = ['applied', 'followup'];
const statusLabel = (s: AppStatus): string => APP_STATUSES.find((x) => x.id === s)?.label ?? s;

const SELECT = `
  select a.*,
    (select max(e.at) from application_events e where e.application_id = a.id) as last_event_at,
    (select min(e.at) from application_events e where e.application_id = a.id and e.type = 'interview' and e.at >= now()) as next_interview_at
  from applications a`;

export async function listApplications(opts: { status?: string; q?: string } = {}): Promise<Application[]> {
  const d = await db();
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status && opts.status !== 'all') {
    const list = opts.status.split(',').filter((s) => STATUS_IDS.includes(s as AppStatus));
    if (list.length) {
      params.push(list);
      where.push(`a.status = any($${params.length})`);
    }
  }
  if (opts.q) {
    params.push(`%${opts.q.toLowerCase()}%`);
    where.push(`(lower(a.title) like $${params.length} or lower(a.company) like $${params.length} or lower(a.notes) like $${params.length})`);
  }
  const rows = await d.query(`${SELECT} ${where.length ? `where ${where.join(' and ')}` : ''} order by a.updated_at desc limit 500`, params);
  return rows.map(mapApplication);
}

export async function getApplication(id: number): Promise<{ application: Application; events: AppEvent[] }> {
  const d = await db();
  const [row] = await d.query(`${SELECT} where a.id = $1`, [id]);
  if (!row) throw new HttpError(404, 'Candidature introuvable');
  const events = await d.query('select * from application_events where application_id = $1 order by at desc, id desc', [id]);
  return { application: mapApplication(row), events: events.map(mapEvent) };
}

export async function addEvent(applicationId: number, e: { type: EventType; title: string; body?: string; at?: string | null; meta?: Record<string, unknown> }): Promise<AppEvent> {
  const d = await db();
  const [row] = await d.query(
    `insert into application_events (application_id, type, title, body, at, meta) values ($1, $2, $3, $4, coalesce($5::timestamptz, now()), $6::jsonb) returning *`,
    [applicationId, e.type, str(e.title, 300), str(e.body, 20000), e.at || null, JSON.stringify(e.meta ?? {})],
  );
  await d.query('update applications set updated_at = now() where id = $1', [applicationId]);
  return mapEvent(row);
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d;
}

const FIELDS: Record<string, string> = {
  title: 'title',
  company: 'company',
  location: 'location',
  url: 'url',
  source: 'source',
  contract: 'contract',
  salaryText: 'salary_text',
  priority: 'priority',
  matchScore: 'match_score',
  appliedAt: 'applied_at',
  nextFollowupAt: 'next_followup_at',
  contactName: 'contact_name',
  contactEmail: 'contact_email',
  contactPhone: 'contact_phone',
  contactRole: 'contact_role',
  notes: 'notes',
  coverLetter: 'cover_letter',
  description: 'description',
  offerId: 'offer_id',
};

export async function createApplication(input: Partial<Application>): Promise<Application> {
  const title = str(input.title, 300).trim();
  if (!title) throw new HttpError(400, 'Intitulé requis');
  const status: AppStatus = STATUS_IDS.includes(input.status as AppStatus) ? (input.status as AppStatus) : 'wishlist';
  const settings = await getSettings();
  const appliedAt = input.appliedAt ? new Date(input.appliedAt) : status !== 'wishlist' ? new Date() : null;
  const nextFollowup = OPEN_FOLLOWUP.includes(status) && appliedAt ? addDays(appliedAt, settings.followupDelays[0] ?? 7) : null;
  const d = await db();
  const [row] = await d.query(
    `insert into applications (offer_id, title, company, location, url, source, contract, salary_text, status, priority, match_score, applied_at, next_followup_at,
      contact_name, contact_email, contact_phone, contact_role, notes, cover_letter, description)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning id`,
    [
      input.offerId ?? null,
      title,
      str(input.company, 200),
      str(input.location, 200),
      str(input.url, 2000),
      input.source ?? null,
      input.contract ?? null,
      str(input.salaryText, 300),
      status,
      [1, 2, 3].includes(Number(input.priority)) ? Number(input.priority) : 2,
      input.matchScore ?? null,
      appliedAt,
      nextFollowup,
      str(input.contactName, 200),
      str(input.contactEmail, 200),
      str(input.contactPhone, 50),
      str(input.contactRole, 200),
      str(input.notes),
      str(input.coverLetter),
      str(input.description, 60000),
    ],
  );
  await addEvent(row.id, { type: 'created', title: status === 'wishlist' ? 'Ajoutée à la liste « À postuler »' : `Candidature créée (${statusLabel(status)})` });
  if (input.offerId) await d.query(`update offers set status = 'applied' where id = $1`, [input.offerId]);
  return (await getApplication(row.id)).application;
}

export async function updateApplication(id: number, patch: Partial<Application>): Promise<Application> {
  const d = await db();
  const { application: before } = await getApplication(id);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, col] of Object.entries(FIELDS)) {
    if (!(k in patch)) continue;
    let v = (patch as Record<string, unknown>)[k];
    if (k === 'priority') v = [1, 2, 3].includes(Number(v)) ? Number(v) : 2;
    if ((k === 'appliedAt' || k === 'nextFollowupAt') && v) v = new Date(v as string);
    if (typeof v === 'string') v = v.slice(0, k === 'description' ? 60000 : 20000);
    params.push(v === '' && (k === 'appliedAt' || k === 'nextFollowupAt') ? null : v);
    sets.push(`${col} = $${params.length}`);
  }
  let statusChanged = false;
  if (patch.status && patch.status !== before.status) {
    if (!STATUS_IDS.includes(patch.status)) throw new HttpError(400, 'Statut inconnu');
    statusChanged = true;
    params.push(patch.status);
    sets.push(`status = $${params.length}`);
    const settings = await getSettings();
    if (patch.status === 'applied' && !before.appliedAt && !('appliedAt' in patch)) {
      const now = new Date();
      params.push(now);
      sets.push(`applied_at = $${params.length}`);
      if (!('nextFollowupAt' in patch)) {
        params.push(addDays(now, settings.followupDelays[0] ?? 7));
        sets.push(`next_followup_at = $${params.length}`);
      }
    } else if (!OPEN_FOLLOWUP.includes(patch.status) && patch.status !== 'interview' && !('nextFollowupAt' in patch)) {
      sets.push('next_followup_at = null');
    }
  }
  if (sets.length) {
    params.push(id);
    await d.query(`update applications set ${sets.join(', ')}, updated_at = now() where id = $${params.length}`, params);
  }
  if (statusChanged) {
    await addEvent(id, { type: 'status', title: `${statusLabel(before.status)} → ${statusLabel(patch.status!)}`, meta: { from: before.status, to: patch.status } });
  }
  return (await getApplication(id)).application;
}

export async function deleteApplication(id: number): Promise<void> {
  const d = await db();
  const [row] = await d.query<{ offer_id: number | null }>('delete from applications where id = $1 returning offer_id', [id]);
  if (row?.offer_id) await d.query(`update offers set status = 'saved' where id = $1 and status = 'applied'`, [row.offer_id]);
}

/** Log a follow-up (relance) and schedule the next one from the settings' delays. */
export async function logFollowup(id: number, input: { channel?: string; body?: string; at?: string }): Promise<Application> {
  const d = await db();
  const { application } = await getApplication(id);
  const settings = await getSettings();
  const count = application.followupCount + 1;
  const at = input.at ? new Date(input.at) : new Date();
  const delay = settings.followupDelays[Math.min(count, settings.followupDelays.length - 1)] ?? 10;
  const next = count >= settings.maxFollowups ? null : addDays(at, delay);
  const status: AppStatus = application.status === 'applied' || application.status === 'wishlist' ? 'followup' : application.status;
  await d.query(
    `update applications set followup_count = $1, next_followup_at = $2, status = $3, followup_notified_at = null, applied_at = coalesce(applied_at, $4), updated_at = now() where id = $5`,
    [count, next, status, at, id],
  );
  await addEvent(id, {
    type: 'followup',
    title: `Relance n°${count}${input.channel ? ` (${input.channel})` : ''}`,
    body: input.body ?? '',
    at: at.toISOString(),
    meta: { channel: input.channel ?? null, count },
  });
  if (status !== application.status) await addEvent(id, { type: 'status', title: `${statusLabel(application.status)} → ${statusLabel(status)}`, meta: { from: application.status, to: status } });
  return (await getApplication(id)).application;
}

/** Interview scheduled → status "Entretien" and a thank-you follow-up the next working days. */
export async function scheduleInterview(id: number, input: { at: string; title?: string; body?: string; location?: string }): Promise<AppEvent> {
  const at = new Date(input.at);
  if (Number.isNaN(at.getTime())) throw new HttpError(400, 'Date d’entretien invalide');
  const { application } = await getApplication(id);
  const ev = await addEvent(id, { type: 'interview', title: input.title || 'Entretien', body: input.body ?? '', at: at.toISOString(), meta: { location: input.location ?? '' } });
  const d = await db();
  await d.query(`update applications set status = 'interview', next_followup_at = $1, followup_notified_at = null, updated_at = now() where id = $2`, [addDays(at, 3), id]);
  if (application.status !== 'interview')
    await addEvent(id, { type: 'status', title: `${statusLabel(application.status)} → ${statusLabel('interview')}`, meta: { from: application.status, to: 'interview' } });
  return ev;
}

export async function deleteEvent(appId: number, eventId: number): Promise<void> {
  const d = await db();
  await d.query('delete from application_events where id = $1 and application_id = $2', [eventId, appId]);
}
