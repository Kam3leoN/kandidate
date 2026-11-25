import { describe, expect, it } from 'vitest';
import { analyzeAd, matchProfile, parseSalary, detectRemote, detectContract, normalize, titleSimilarity, scoreOffer } from '../shared/analysis/index.js';
import { EMPTY_PROFILE, type Profile } from '../shared/types.js';

const AD_FRONT = `Développeur Front-End React / TypeScript (H/F)
Acme Digital recrute
Lieu : Lyon 3e
CDI – Télétravail 2 jours par semaine

Vos missions :
• Développer les interfaces de notre plateforme SaaS en React et TypeScript
• Contribuer à notre design system (Storybook, Figma)
• Garantir l'accessibilité (RGAA) et la performance

Profil recherché :
• 3 à 5 ans d'expérience en développement front-end
• Maîtrise indispensable de React, TypeScript et CSS
• Bonne connaissance des tests automatisés (Jest, Playwright)
• Anglais professionnel
• Une expérience avec Next.js serait un plus

Avantages :
Salaire : 45 000 € - 55 000 € brut annuel, tickets restaurant, mutuelle, RTT.`;

const PROFILE: Profile = {
  ...EMPTY_PROFILE,
  fullName: 'Cédric',
  location: { label: 'Lyon', dept: '69', lat: 45.764, lon: 4.8357 },
  mobilityKm: 30,
  remotePref: 'hybrid',
  contracts: ['CDI', 'Freelance'],
  salaryMin: 45000,
  salaryTarget: 52000,
  experienceYears: 6,
  targetTitles: ['Développeur front-end', 'Lead dev front'],
  skills: [
    { name: 'React', level: 4, core: true },
    { name: 'TypeScript', level: 5, core: true },
    { name: 'CSS', level: 5 },
    { name: 'Figma', level: 3 },
    { name: 'Web Components', level: 5, core: true },
    { name: 'Accessibilité', level: 4 },
  ],
  languages: [{ name: 'Anglais', level: 'courant' }],
};

describe('text helpers', () => {
  it('normalizes accents and quotes', () => {
    expect(normalize('Expérience’S  Élevée')).toBe("experience's elevee");
  });
});

describe('salary parsing', () => {
  it('parses a range in euros', () => {
    const s = parseSalary('45 000 € - 55 000 € brut annuel');
    expect(s?.annualMin).toBe(45000);
    expect(s?.annualMax).toBe(55000);
    expect(s?.period).toBe('year');
  });
  it('parses k€ ranges', () => {
    const s = parseSalary('Rémunération : 45-55k€ selon profil');
    expect(s?.annualMin).toBe(45000);
    expect(s?.annualMax).toBe(55000);
  });
  it('parses France Travail format', () => {
    const s = parseSalary('Annuel de 38000.0 Euros à 42000.0 Euros sur 12 mois');
    expect(s?.annualMin).toBe(38000);
    expect(s?.annualMax).toBe(42000);
  });
  it('parses a monthly salary', () => {
    const s = parseSalary('Salaire : 2 800 € brut mensuel');
    expect(s?.period).toBe('month');
    expect(s?.annualMin).toBe(33600);
  });
  it('parses a freelance daily rate', () => {
    const s = parseSalary('TJM : 550 € / jour');
    expect(s?.period).toBe('day');
    expect(s?.annualMin).toBe(550 * 218);
  });
  it('ignores meal tickets', () => {
    expect(parseSalary('tickets restaurant de 10 € pris en charge à 60 %')).toBeNull();
  });
});

describe('contract & remote', () => {
  it('detects CDI and hybrid days', () => {
    expect(detectContract(normalize('Poste en CDI à Lyon')).contract).toBe('CDI');
    expect(detectRemote(normalize('Télétravail 2 jours par semaine'))).toEqual({ remote: 'hybrid', days: 2 });
    expect(detectRemote(normalize('Poste 100% télétravail')).remote).toBe('full');
  });
  it('detects alternance before CDD', () => {
    expect(detectContract(normalize('Contrat en alternance (apprentissage) de 24 mois')).contract).toBe('Alternance');
  });
});

describe('analyzeAd', () => {
  const ad = analyzeAd({ text: AD_FRONT });
  it('extracts meta', () => {
    expect(ad.title).toMatch(/Développeur Front-End React/);
    expect(ad.company).toBe('Acme Digital');
    expect(ad.location).toMatch(/Lyon/);
    expect(ad.contract).toBe('CDI');
    expect(ad.remote).toBe('hybrid');
    expect(ad.remoteDays).toBe(2);
    expect(ad.experience).toMatchObject({ min: 3, max: 5 });
    expect(ad.salary?.annualMax).toBe(55000);
  });
  it('classifies required vs nice-to-have skills', () => {
    const req = ad.skills.filter((s) => s.required).map((s) => s.label);
    const nice = ad.skills.filter((s) => !s.required).map((s) => s.label);
    expect(req).toEqual(expect.arrayContaining(['React', 'TypeScript', 'CSS', 'Tests automatisés']));
    expect(nice).toContain('Next.js');
    expect(ad.languages[0]).toMatchObject({ id: 'en', required: true });
  });
  it('lists benefits as positive signals', () => {
    const labels = ad.signals.map((s) => s.label);
    expect(labels).toEqual(expect.arrayContaining(['Titres-restaurant', 'Mutuelle / prévoyance', 'RTT']));
  });
  it('does not confuse the French word "vue" with Vue.js', () => {
    const a = analyzeAd({ text: 'En vue de renforcer notre équipe, point de vue client.' });
    expect(a.skills.find((s) => s.label === 'Vue.js')).toBeUndefined();
  });
});

describe('matchProfile', () => {
  it('scores a well matching offer high', () => {
    const ad = analyzeAd({ text: AD_FRONT, extraSkills: PROFILE.skills });
    const m = matchProfile(ad, PROFILE);
    expect(m.score).toBeGreaterThanOrEqual(75);
    expect(m.matchedSkills).toEqual(expect.arrayContaining(['React', 'TypeScript']));
    expect(m.missingRequired).toContain('Tests automatisés');
    expect(m.dealbreakers).toHaveLength(0);
  });
  it('penalizes a non wanted contract and low salary', () => {
    const ad = analyzeAd({ text: 'Stage développeur Java Spring Boot – gratification 1 200 € par mois. Maîtrise de Java exigée.' });
    const m = matchProfile(ad, PROFILE);
    expect(m.dealbreakers.length).toBeGreaterThan(0);
    expect(m.score).toBeLessThanOrEqual(45);
  });
  it('compares job titles with synonyms', () => {
    expect(titleSimilarity('Développeur front-end', 'Frontend Developer React')).toBeGreaterThan(0.6);
    expect(titleSimilarity('Développeur front-end', 'Comptable fournisseurs')).toBe(0);
  });
  it('uses coordinates for distance', () => {
    const near = scoreOffer({ title: 'Développeur front-end React', description: AD_FRONT, lat: 45.75, lon: 4.85, contract: 'CDI' }, PROFILE);
    const far = scoreOffer({ title: 'Développeur front-end React', description: AD_FRONT.replace(/Télétravail.*\n/, '\n'), lat: 48.85, lon: 2.35, contract: 'CDI' }, PROFILE);
    expect(near.match.score).toBeGreaterThan(far.match.score);
  });
});

describe('salary period edge cases', () => {
  it('keeps k€ amounts yearly even near "par mois"', () => {
    const s = parseSalary('Astreintes un week-end par mois. 40-45k€.');
    expect(s?.period).toBe('year');
    expect(s?.annualMax).toBe(45000);
  });
  it('reads a monthly salary from the words after the amount', () => {
    expect(parseSalary('Rémunération : 2 400 € brut par mois, 13e mois')?.period).toBe('month');
  });
});

describe('excluded keywords & context skills', () => {
  it('flags an excluded keyword found anywhere in the ad', () => {
    const text = `${AD_FRONT}\nAstreintes ponctuelles lors des mises en production.`;
    const r = scoreOffer({ title: 'Développeur front-end React', description: text }, { ...PROFILE, excludedKeywords: ['astreintes'] });
    expect(r.match.dealbreakers.some((d) => d.includes('astreintes'))).toBe(true);
    expect(r.match.score).toBeLessThanOrEqual(45);
  });
  it('does not require skills only cited in the company blurb', () => {
    const a = analyzeAd({ text: `Qui sommes-nous ?\nNotre équipe travaille en Scrum avec Kubernetes.\n\nProfil recherché :\nMaîtrise de React.` });
    expect(a.skills.find((s) => s.label === 'Scrum')?.required).toBe(false);
    expect(a.skills.find((s) => s.label === 'React')?.required).toBe(true);
  });
});
