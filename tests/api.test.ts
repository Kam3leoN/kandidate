/**
 * End-to-end API test on an in-memory PGlite database (no network needed).
 */
import { beforeAll, describe, expect, it } from 'vitest';

process.env.PGLITE_DIR = 'memory';
delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;
process.env.REMOTIVE_DISABLED = '1';

const { handle } = await import('../server/app.js');

async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await handle(
    new Request(`http://localhost/api${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

const AD = `Product Designer UX/UI (H/F)
Entreprise : Lumen Studio
Lieu : Lyon
CDI · Télétravail 3 jours par semaine
Missions : concevoir les parcours, faire évoluer le design system dans Figma, mener des tests utilisateurs.
Profil : 4 ans d'expérience minimum en UX design. Maîtrise de Figma indispensable. Notions de HTML/CSS appréciées.
Salaire : 48k€ - 56k€`;

const ALERT_HTML = `<html><body>
<table><tr><td><a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc">Développeur Front-End React (H/F)</a></td></tr>
<tr><td>Acme Corp · Lyon, Auvergne-Rhône-Alpes, France (Hybride)</td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/view/4012345679/?trk=x">Lead UX Designer</a></td></tr>
<tr><td>Studio Nova · Paris (Sur site)</td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/search/?keywords=react">Voir toutes les offres</a></td></tr>
<tr><td><a href="https://www.linkedin.com/comm/psettings/email-unsubscribe">Se désabonner</a></td></tr>
</table></body></html>`;

describe('API', () => {
  beforeAll(async () => {
    const r = await api('GET', '/health');
    expect(r.status).toBe(200);
  });

  it('reports auth mode', async () => {
    const r = await api('GET', '/auth/me');
    expect(r.data).toEqual({ authenticated: true, authRequired: false });
  });

  it('saves the profile', async () => {
    const r = await api('PUT', '/profile', {
      fullName: 'Cédric',
      targetTitles: ['Product designer', 'UX designer'],
      skills: [
        { name: 'Figma', level: 5, core: true },
        { name: 'UX design', level: 4, core: true },
        { name: 'Design system', level: 4 },
      ],
      contracts: ['CDI'],
      experienceYears: 6,
      salaryMin: 45000,
      location: { label: 'Lyon (69)', dept: '69', lat: 45.76, lon: 4.83 },
    });
    expect(r.status).toBe(200);
    expect(r.data.profile.skills).toHaveLength(3);
  });

  it('analyzes a pasted ad', async () => {
    const r = await api('POST', '/analyze', { text: AD });
    expect(r.status).toBe(200);
    expect(r.data.offer.company).toBe('Lumen Studio');
    expect(r.data.analysis.remoteDays).toBe(3);
    expect(r.data.match.score).toBeGreaterThan(70);
  });

  let appId = 0;
  it('stores the offer and turns it into an application', async () => {
    const a = await api('POST', '/analyze', { text: AD });
    const saved = await api('POST', '/offers', { offer: a.data.offer });
    expect(saved.status).toBe(200);
    const app = await api('POST', `/offers/${saved.data.id}/apply`, { status: 'applied' });
    expect(app.status).toBe(200);
    expect(app.data.status).toBe('applied');
    expect(app.data.nextFollowupAt).toBeTruthy();
    appId = app.data.id;
  });

  it('logs a follow-up and schedules the next one', async () => {
    const r = await api('POST', `/applications/${appId}/followup`, { channel: 'email', body: 'Relance polie' });
    expect(r.data.status).toBe('followup');
    expect(r.data.followupCount).toBe(1);
    const detail = await api('GET', `/applications/${appId}`);
    expect(detail.data.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['followup', 'status', 'created']));
  });

  it('schedules an interview', async () => {
    const at = new Date(Date.now() + 5 * 3600_000).toISOString();
    const r = await api('POST', `/applications/${appId}/events`, { type: 'interview', at, title: 'Entretien RH', location: 'Visio' });
    expect(r.status).toBe(200);
    const d = await api('GET', `/applications/${appId}`);
    expect(d.data.application.status).toBe('interview');
    expect(d.data.application.nextInterviewAt).toBeTruthy();
  });

  it('imports offers from a pasted LinkedIn alert email', async () => {
    const r = await api('POST', '/inbound/paste', { html: ALERT_HTML, subject: 'Alerte : Développeur front', from: 'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>' });
    expect(r.status).toBe(200);
    expect(r.data.found).toBe(2);
    const offers = await api('GET', '/offers?source=email&status=all');
    const first = offers.data.items.find((o: { title: string }) => o.title.startsWith('Développeur'));
    expect(first.company).toBe('Acme Corp');
    expect(first.url).toBe('https://www.linkedin.com/jobs/view/4012345678/');
    const notifs = await api('GET', '/notifications');
    expect(notifs.data.unread).toBeGreaterThan(0);
  });

  it('runs the watch (no source configured) and reminds the interview', async () => {
    const r = await api('POST', '/watch/run', {});
    expect(r.status).toBe(200);
    expect(r.data.interviews).toBe(1);
    const n = await api('GET', '/notifications');
    expect(n.data.items.some((x: { kind: string }) => x.kind === 'interview_soon')).toBe(true);
  });

  it('computes dashboard stats', async () => {
    const r = await api('GET', '/stats');
    expect(r.status).toBe(200);
    expect(r.data.sent).toBe(1);
    expect(r.data.weeklyApplications).toHaveLength(12);
  });

  it('creates and lists saved searches', async () => {
    const c = await api('POST', '/searches', { name: 'Designer Lyon', keywords: 'product designer', location: { label: 'Lyon (69)', insee: '69123', dept: '69' }, contracts: ['CDI'], sources: ['france_travail', 'adzuna'] });
    expect(c.status).toBe(200);
    const l = await api('GET', '/searches');
    expect(l.data).toHaveLength(1);
  });

  it('rejects non-JSON mutations (CSRF guard)', async () => {
    const res = await handle(new Request('http://localhost/api/applications', { method: 'POST', body: 'title=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
    expect(res.status).toBe(415);
  });

  it('handles the Vercel rewrite path', async () => {
    const res = await handle(new Request('http://localhost/api/handler?__p=stats'));
    expect(res.status).toBe(200);
  });
});
