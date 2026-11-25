import type { NormalizedOffer, Profile } from '../types.js';
import { analyzeAd, type AdAnalysis } from './extract.js';
import { matchProfile, type MatchResult } from './match.js';

export * from './extract.js';
export * from './match.js';
export * from './skills.js';
export * from './text.js';

export interface Scored {
  analysis: AdAnalysis;
  match: MatchResult;
}

/** Analyze an offer coming from a connector / import and score it against the profile. */
export function scoreOffer(offer: Partial<NormalizedOffer> & { title: string; description: string }, profile: Profile): Scored {
  const analysis = analyzeAd({
    text: offer.description ?? '',
    title: offer.title,
    company: offer.company,
    location: offer.location,
    contract: offer.contract ?? null,
    remote: offer.remote ?? null,
    salaryText: offer.salaryText,
    salaryMin: offer.salaryMin ?? null,
    salaryMax: offer.salaryMax ?? null,
    extraSkills: profile.skills.map((s) => ({ name: s.name })),
  });
  const match = matchProfile(analysis, profile, { lat: offer.lat ?? null, lon: offer.lon ?? null, text: offer.description });
  return { analysis, match };
}
