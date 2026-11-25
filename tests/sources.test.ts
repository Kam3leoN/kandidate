/**
 * Connectors mapping with a mocked fetch (no network) + alert email parser.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adzuna, jooble, lba, remotive } from '../server/sources/aggregators.js';
import { franceTravail } from '../server/sources/france-travail.js';
import { parseAlertEmail } from '../server/importers/email-alert.js';

type Call = { url: string; init?: RequestInit };

function mockFetch(routes: Array<[RegExp, unknown, number?]>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const hit = routes.find(([re]) => re.test(u));
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: hit[2] ?? 200, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('France Travail', () => {
  it('gets a token then maps offers', async () => {
    vi.stubEnv('FRANCE_TRAVAIL_CLIENT_ID', 'id');
    vi.stubEnv('FRANCE_TRAVAIL_CLIENT_SECRET', 'secret');
    const calls = mockFetch([
      [/access_token/, { access_token: 'tok', expires_in: 1499 }],
      [
        /offres\/search/,
        {
          resultats: [
            {
              id: '187ABCD',
              intitule: 'Développeur front-end (H/F)',
              description: 'Vous développerez en React.',
              dateCreation: '2026-11-20T10:00:00.000Z',
              lieuTravail: { libelle: '69 - LYON 03', latitude: 45.76, longitude: 4.85 },
              entreprise: { nom: 'ACME' },
              typeContrat: 'CDI',
              competences: [{ libelle: 'TypeScript', exigence: 'E' }],
              salaire: { libelle: 'Annuel de 42000.0 Euros à 48000.0 Euros sur 12 mois' },
              origineOffre: { urlOrigine: 'https://candidat.francetravail.fr/offres/recherche/detail/187ABCD' },
            },
          ],
        },
        206,
      ],
    ]);
    const r = await franceTravail.search({ keywords: 'développeur front', location: { label: 'Lyon', insee: '69123' }, radiusKm: 20, contracts: ['CDI'], publishedSinceDays: 5, salaryMin: 40000 });
    expect(calls[0].url).toContain('access_token');
    expect(String(calls[0].init?.body)).toContain('scope=api_offresdemploiv2');
    const search = new URL(calls[1].url);
    expect(search.searchParams.get('motsCles')).toBe('développeur,front');
    expect(search.searchParams.get('commune')).toBe('69123');
    expect(search.searchParams.get('distance')).toBe('20');
    expect(search.searchParams.get('typeContrat')).toBe('CDI');
    expect(search.searchParams.get('publieeDepuis')).toBe('7');
    expect(search.searchParams.get('periodeSalaire')).toBe('A');
    expect((calls[1].init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(r[0]).toMatchObject({ source: 'france_travail', sourceId: '187ABCD', company: 'ACME', contract: 'CDI', lat: 45.76 });
    expect(r[0].description).toContain('TypeScript');
  });
});

describe('Adzuna', () => {
  it('maps results and ignores predicted salaries', async () => {
    vi.stubEnv('ADZUNA_APP_ID', 'a');
    vi.stubEnv('ADZUNA_APP_KEY', 'b');
    const calls = mockFetch([
      [
        /api\.adzuna\.com\/v1\/api\/jobs\/fr\/search\/1/,
        {
          results: [
            { id: '9', title: '<strong>Développeur</strong> React', description: 'Snippet…', created: '2026-11-21T08:00:00Z', redirect_url: 'https://www.adzuna.fr/land/ad/9', company: { display_name: 'Beta' }, location: { display_name: 'Lyon, Rhône' }, salary_min: 40000, salary_max: 40000, salary_is_predicted: '1', contract_type: 'permanent' },
          ],
        },
      ],
    ]);
    const r = await adzuna.search({ keywords: 'react', location: { label: 'Lyon (69)' }, contracts: ['CDI'] });
    const u = new URL(calls[0].url);
    expect(u.searchParams.get('where')).toBe('Lyon');
    expect(u.searchParams.get('permanent')).toBe('1');
    expect(r[0]).toMatchObject({ title: 'Développeur React', company: 'Beta', contract: 'CDI', salaryMin: null });
  });
});

describe('Jooble', () => {
  it('posts JSON to the keyed endpoint', async () => {
    vi.stubEnv('JOOBLE_API_KEY', 'k3y');
    const calls = mockFetch([[/fr\.jooble\.org\/api\/k3y/, { totalCount: 1, jobs: [{ id: 5, title: 'Product designer', link: 'https://fr.jooble.org/desc/5', company: 'Gamma', location: 'Paris', snippet: '<b>Figma</b> et UX', type: 'CDI', salary: '45k€', updated: '2026-11-22T00:00:00' }] }]]);
    const r = await jooble.search({ keywords: 'designer', radiusKm: 30 });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.radius).toBe('40');
    expect(r[0]).toMatchObject({ source: 'jooble', title: 'Product designer', contract: 'CDI', salaryText: '45k€' });
  });
});

describe('La bonne alternance', () => {
  it('requires geo or ROME and filters by keyword', async () => {
    vi.stubEnv('LBA_API_TOKEN', 't');
    await expect(lba.search({ keywords: 'dev' })).rejects.toThrow(/lieu ou des codes ROME/);
    mockFetch([
      [
        /job\/v1\/search/,
        {
          jobs: [
            { identifier: { id: 'x1' }, workplace: { name: 'Delta', location: { address: 'Lyon', geopoint: { coordinates: [4.8, 45.7] } } }, apply: { url: 'https://lba/x1' }, contract: { type: ['Apprentissage'], remote: 'hybrid' }, offer: { title: 'Développeur web en alternance', description: 'Vue.js' } },
            { identifier: { id: 'x2' }, workplace: { name: 'Eps' }, offer: { title: 'Comptable', description: '' } },
          ],
          recruiters: [],
          warnings: [],
        },
      ],
    ]);
    const r = await lba.search({ keywords: 'développeur', location: { label: 'Lyon', lat: 45.7, lon: 4.8 } });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ contract: 'Alternance', remote: 'hybrid', lat: 45.7, lon: 4.8 });
  });
});

describe('Remotive', () => {
  it('keeps Europe-compatible remote jobs', async () => {
    mockFetch([
      [
        /remotive\.com\/api\/remote-jobs/,
        {
          jobs: [
            { id: 1, url: 'https://remotive.com/1', title: 'Frontend', company_name: 'R1', candidate_required_location: 'Europe', job_type: 'contract', publication_date: new Date().toISOString(), description: '<p>Vue</p>' },
            { id: 2, url: 'https://remotive.com/2', title: 'Backend', company_name: 'R2', candidate_required_location: 'USA only', publication_date: new Date().toISOString() },
          ],
        },
      ],
    ]);
    const r = await remotive.search({ keywords: 'frontend' });
    expect(r.map((o) => o.sourceId)).toEqual(['1']);
    expect(r[0]).toMatchObject({ remote: 'full', contract: 'Freelance' });
  });
});

describe('alert email parser', () => {
  it('reads Cadremploi and APEC links, skipping CTAs', () => {
    const html = `
      <p>Bonjour, voici 2 nouvelles offres</p>
      <h3>Responsable marketing digital H/F</h3><p>Groupe Omega</p><p>Paris (75)</p>
      <a href="https://click.example.net/r?url=https%3A%2F%2Fwww.cadremploi.fr%2Femploi%2Fdetail_offre%3FoffreId%3D150123456">Voir l'offre</a>
      <a href="https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/176543210W">Chef de projet digital (H/F)</a><div>Sigma Conseil</div><div>Lyon 69</div>
      <a href="https://www.cadremploi.fr/compte/desinscription">Se désinscrire</a>`;
    const r = parseAlertEmail({ html, subject: 'Vos offres Cadremploi', from: 'Cadremploi <alertes@cadremploi.fr>' });
    expect(r.offers.map((o) => o.sourceId).sort()).toEqual(['apec-176543210W', 'ce-150123456']);
    const ce = r.offers.find((o) => o.sourceId === 'ce-150123456')!;
    expect(ce).toMatchObject({ title: 'Responsable marketing digital H/F', company: 'Groupe Omega', location: 'Paris (75)' });
    expect(ce.url).toBe('https://www.cadremploi.fr/emploi/detail_offre?offreId=150123456');
    const apec = r.offers.find((o) => o.sourceId.startsWith('apec'))!;
    expect(apec).toMatchObject({ title: 'Chef de projet digital (H/F)', company: 'Sigma Conseil', location: 'Lyon 69' });
  });
});
