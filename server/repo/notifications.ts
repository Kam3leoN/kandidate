import type { AppNotification, NotificationKind } from '../../shared/types.js';
import { db } from '../db.js';

type Row = Record<string, any>;

export function mapNotification(r: Row): AppNotification {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    url: r.url,
    readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    meta: r.meta ?? {},
  };
}

export async function insertNotification(n: { kind: NotificationKind; title: string; body?: string; url?: string; meta?: Record<string, unknown> }): Promise<AppNotification> {
  const d = await db();
  const [r] = await d.query(`insert into notifications (kind, title, body, url, meta) values ($1,$2,$3,$4,$5::jsonb) returning *`, [
    n.kind,
    n.title.slice(0, 300),
    (n.body ?? '').slice(0, 2000),
    n.url ?? '',
    JSON.stringify(n.meta ?? {}),
  ]);
  return mapNotification(r);
}

export async function listNotifications(opts: { unread?: boolean; limit?: number } = {}): Promise<{ items: AppNotification[]; unread: number }> {
  const d = await db();
  const rows = await d.query(`select * from notifications ${opts.unread ? 'where read_at is null' : ''} order by created_at desc limit ${Math.min(opts.limit ?? 50, 200)}`);
  const [{ n }] = await d.query<{ n: number }>('select count(*)::int as n from notifications where read_at is null');
  return { items: rows.map(mapNotification), unread: n };
}

export async function markRead(ids: number[] | 'all'): Promise<void> {
  const d = await db();
  if (ids === 'all') await d.query('update notifications set read_at = now() where read_at is null');
  else if (ids.length) await d.query('update notifications set read_at = now() where id = any($1) and read_at is null', [ids]);
}

export async function deleteNotification(id: number): Promise<void> {
  const d = await db();
  await d.query('delete from notifications where id = $1', [id]);
}

export async function pendingForDigest(): Promise<AppNotification[]> {
  const d = await db();
  const rows = await d.query(`select * from notifications where emailed_at is null and kind <> 'digest' and created_at > now() - interval '3 days' order by created_at desc limit 100`);
  return rows.map(mapNotification);
}

export async function markEmailed(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const d = await db();
  await d.query('update notifications set emailed_at = now() where id = any($1)', [ids]);
}

export async function pruneNotifications(): Promise<void> {
  const d = await db();
  await d.query(`delete from notifications where created_at < now() - interval '90 days'`);
}
