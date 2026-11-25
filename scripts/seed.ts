/**
 * npm run db:seed — fictional demo data to explore the UI locally.
 * Refuses to touch a Neon database unless you pass --force.
 */
import './env.js';
import { scoreOffer } from '../shared/analysis/index.js';
import type { NormalizedOffer } from '../shared/types.js';
import { getDb } from '../server/db.js';
import { addEvent, createApplication, logFollowup, scheduleInterview, updateApplication } from '../server/repo/applications.js';
import { insertNotification } from '../server/repo/notifications.js';
import { upsertOffers } from '../server/repo/offers.js';
import { saveProfile } from '../server/repo/profile.js';
import { createSearch } from '../server/repo/searches.js';

const db = await getDb();
if (db.kind === 'neon' && !process.argv.includes('--force')) {
  console.error('✖ DATABASE_URL pointe vers Neon : ajoute --force pour y insérer des données de démo.');
  process.exit(1);
}

const profile = await saveProfile({
  fullName: 'Camille Démo',
  headline: 'Développeuse front-end · Design systems',
  email: 'camille@example.com',
  location: { label: 'Lyon (69)', insee: '69123', dept: '69', lat: 45.758, lon: 4.835 },
  mobilityKm: 35,
  remotePref: 'hybrid',
  contracts: ['CDI', 'Freelance'],
  salaryMin: 45000,
  salaryTarget: 52000,
  experienceYears: 6,
  educationLevel: 5,
  targetTitles: ['Développeur front-end', 'Lead dev front', 'Product designer'],
  skills: [
    { name: 'TypeScript', level: 5, core: true },
    { name: 'React', level: 4, core: true },
    { name: 'Web Components', level: 5, core: true },
    { name: 'CSS', level: 5 },
    { name: 'Design system', level: 5, core: true },
    { name: 'Figma', level: 4 },
    { name: 'Accessibilité', level: 4 },
    { name: 'Vue.js', level: 3 },
    { name: 'Node.js', level: 3 },
    { name: 'Tests automatisés', level: 3 },
    { name: 'Git', level: 4 },
    { name: 'Agile', level: 4 },
    { name: 'Autonomie', level: 5 },
  ],
  languages: [{ name: 'Anglais', level: 'courant' }],
  excludedKeywords: ['astreintes'],
  cvText: 'Développeuse front-end TypeScript React, web components (Lit), design system Material 3, accessibilité RGAA, Figma, tests Vitest/Playwright, Node.js, Vite, Git, Scrum.',
});

const days = (n: number): string => new Date(Date.now() - n * 86400_000).toISOString();

const offers: NormalizedOffer[] = [
  {
    source: 'france_travail',
    sourceId: 'demo-ft-1',
    url: 'https://candidat.francetravail.fr/',
    title: 'Développeur front-end React / TypeScript (H/F)',
    company: 'Atelier Lumen',
    location: '69 - LYON 03',
    lat: 45.76,
    lon: 4.85,
    contract: 'CDI',
    salaryText: 'Annuel de 46000.0 Euros à 54000.0 Euros sur 12 mois',
    description: `Atelier Lumen conçoit des outils SaaS pour les collectivités.\n\nVos missions :\n• Développer les interfaces en React et TypeScript\n• Faire évoluer notre design system (Storybook, Figma)\n• Garantir l'accessibilité RGAA\n\nProfil recherché :\n• 4 ans d'expérience minimum\n• Maîtrise indispensable de React, TypeScript et CSS\n• Tests automatisés (Vitest, Playwright)\n• Anglais professionnel\n• Une expérience Next.js serait un plus\n\nTélétravail 2 jours par semaine, tickets restaurant, mutuelle, RTT.`,
    publishedAt: days(1),
  },
  {
    source: 'adzuna',
    sourceId: 'demo-adz-1',
    url: 'https://www.adzuna.fr/',
    title: 'Lead Front-End Engineer – Design System',
    company: 'Nova Mobility',
    location: 'Villeurbanne, Rhône',
    lat: 45.77,
    lon: 4.88,
    contract: 'CDI',
    salaryMin: 55000,
    salaryMax: 65000,
    description: `Nous cherchons un(e) lead front pour piloter notre design system en web components (Lit) et accompagner 4 développeurs. 6 ans d'expérience, TypeScript, accessibilité, performance web. Management d'équipe. Hybride 3 jours de télétravail. BSPCE.`,
    publishedAt: days(2),
  },
  {
    source: 'remotive',
    sourceId: 'demo-rem-1',
    url: 'https://remotive.com/',
    title: 'Senior Frontend Developer (Vue.js)',
    company: 'Orbital Labs',
    location: 'Europe',
    remote: 'full',
    contract: 'Freelance',
    description: `Fully remote, contract. 5+ years of experience with Vue.js 3, TypeScript, Pinia, Vite. GraphQL is a plus. English fluent. TJM 550 € / jour.`,
    publishedAt: days(3),
  },
  {
    source: 'jooble',
    sourceId: 'demo-joo-1',
    url: 'https://fr.jooble.org/',
    title: 'Développeur Java Spring Boot',
    company: 'Banque Rhône Services',
    location: 'Lyon',
    contract: 'CDI',
    description: `Maîtrise de Java, Spring Boot, microservices, Kubernetes exigée. Astreintes un week-end par mois. 40-45k€.`,
    publishedAt: days(4),
  },
  {
    source: 'france_travail',
    sourceId: 'demo-ft-2',
    url: 'https://candidat.francetravail.fr/',
    title: 'UX/UI Designer – Product Designer (H/F)',
    company: 'Coop Digitale',
    location: '69 - LYON 07',
    lat: 45.74,
    lon: 4.84,
    contract: 'CDI',
    description: `Product designer pour notre app mobile : recherche utilisateur, prototypage Figma, design system, tests utilisateurs. 3 ans d'expérience. HTML/CSS apprécié. Salaire 42 000 € - 48 000 €. Télétravail partiel.`,
    publishedAt: days(1),
  },
  {
    source: 'email',
    sourceId: 'demo-li-1',
    url: 'https://www.linkedin.com/jobs/',
    title: 'Frontend Developer (Angular) – CDD 6 mois',
    company: 'Helix Santé',
    location: 'Grenoble',
    contract: 'CDD',
    description: `Offre repérée dans une alerte email LinkedIn. Angular, RxJS, CDD de 6 mois.`,
    publishedAt: days(0),
  },
];

const ins = await upsertOffers(offers, profile);
console.log(`✔ ${ins.inserted.length} offres de démo`);
const byKey = new Map(ins.inserted.map((o) => [o.sourceId, o]));

await createSearch({ name: 'Front-end Lyon', keywords: 'développeur front-end', location: { label: 'Lyon (69)', insee: '69123', dept: '69', lat: 45.758, lon: 4.835 }, radiusKm: 30, contracts: ['CDI'], minScore: 65 });
await createSearch({ name: 'Design system remote', keywords: 'design system frontend', remote: 'full', contracts: ['CDI', 'Freelance'], sources: ['remotive', 'adzuna'], minScore: 70 });

const mk = async (sourceId: string, status: 'wishlist' | 'applied', extra: Record<string, unknown> = {}) => {
  const o = byKey.get(sourceId)!;
  const { match } = scoreOffer(offers.find((x) => x.sourceId === sourceId)!, profile);
  return createApplication({ offerId: o.id, title: o.title, company: o.company, location: o.location, url: o.url, source: o.source, contract: o.contract, matchScore: match.score, description: offers.find((x) => x.sourceId === sourceId)!.description, status, ...extra });
};

const a1 = await mk('demo-ft-1', 'applied', { appliedAt: days(9), contactName: 'Julie Martin', contactEmail: 'julie.martin@example.com', contactRole: 'Talent acquisition' });
const a2 = await mk('demo-adz-1', 'applied', { appliedAt: days(16), priority: 3 });
await logFollowup(a2.id, { channel: 'email', at: days(8) });
await scheduleInterview(a2.id, { at: new Date(Date.now() + 20 * 3600_000).toISOString(), title: 'Entretien technique', location: 'Visio (Meet)' });
await mk('demo-ft-2', 'wishlist');
const a4 = await createApplication({ title: 'Intégrateur web senior', company: 'Studio Pixel', location: 'Lyon', status: 'applied', appliedAt: days(30), matchScore: 58 });
await updateApplication(a4.id, { status: 'rejected' });
const a5 = await createApplication({ title: 'Développeur Lit / Web Components', company: 'Kiosque Média', location: 'Remote', status: 'applied', appliedAt: days(3), matchScore: 88, contract: 'Freelance' });
await addEvent(a5.id, { type: 'call', title: 'Appel de pré-qualification', body: 'TJM évoqué : 520 €. Démarrage janvier.', at: days(1) });
await createApplication({ title: 'Front-end engineer (React)', company: 'Ferro Logistique', location: 'Saint-Priest', status: 'applied', appliedAt: days(12), matchScore: 74 });

await insertNotification({ kind: 'offer_match', title: '2 nouvelles offres pour « Front-end Lyon »', body: '86 % · Développeur front-end React / TypeScript — Atelier Lumen\n81 % · Lead Front-End Engineer – Design System — Nova Mobility', url: '/offers' });
await insertNotification({ kind: 'followup_due', title: `Relance à faire : ${a1.title}`, body: 'Atelier Lumen · relance n°1', url: `/applications/${a1.id}` });

console.log('✔ Données de démo prêtes — npm run dev');
process.exit(0);
