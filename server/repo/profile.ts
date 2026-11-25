import { CONTRACT_TYPES, DEFAULT_SETTINGS, EMPTY_PROFILE, type Profile, type Settings } from '../../shared/types.js';
import { db } from '../db.js';

const clampInt = (v: unknown, min: number, max: number, def: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : def;
};
const strArr = (v: unknown, max = 50): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : [];

export function sanitizeProfile(input: Partial<Profile>): Profile {
  const p = { ...EMPTY_PROFILE, ...input };
  return {
    fullName: String(p.fullName ?? '').slice(0, 120),
    headline: String(p.headline ?? '').slice(0, 200),
    email: String(p.email ?? '').slice(0, 200),
    phone: String(p.phone ?? '').slice(0, 40),
    location:
      p.location && typeof p.location === 'object' && p.location.label
        ? {
            label: String(p.location.label).slice(0, 120),
            insee: p.location.insee ? String(p.location.insee).slice(0, 10) : undefined,
            dept: p.location.dept ? String(p.location.dept).slice(0, 4) : undefined,
            lat: Number.isFinite(Number(p.location.lat)) ? Number(p.location.lat) : undefined,
            lon: Number.isFinite(Number(p.location.lon)) ? Number(p.location.lon) : undefined,
          }
        : null,
    mobilityKm: clampInt(p.mobilityKm, 0, 1000, 30),
    remotePref: (['any', 'onsite', 'hybrid', 'remote'] as const).includes(p.remotePref) ? p.remotePref : 'any',
    contracts: strArr(p.contracts).filter((c): c is Profile['contracts'][number] => (CONTRACT_TYPES as string[]).includes(c)),
    salaryMin: p.salaryMin ? clampInt(p.salaryMin, 0, 1_000_000, 0) : null,
    salaryTarget: p.salaryTarget ? clampInt(p.salaryTarget, 0, 1_000_000, 0) : null,
    experienceYears: clampInt(p.experienceYears, 0, 60, 0),
    educationLevel: p.educationLevel == null ? null : clampInt(p.educationLevel, 0, 8, 0),
    targetTitles: strArr(p.targetTitles, 12),
    skills: Array.isArray(p.skills)
      ? p.skills
          .filter((s) => s && String(s.name ?? '').trim())
          .slice(0, 150)
          .map((s) => ({ name: String(s.name).trim().slice(0, 60), level: clampInt(s.level, 1, 5, 3), core: !!s.core }))
      : [],
    languages: Array.isArray(p.languages)
      ? p.languages
          .filter((l) => l && l.name)
          .slice(0, 10)
          .map((l) => ({
            name: String(l.name).slice(0, 40),
            level: (['notions', 'intermédiaire', 'courant', 'bilingue', 'natif'] as const).includes(l.level) ? l.level : 'intermédiaire',
          }))
      : [],
    excludedKeywords: strArr(p.excludedKeywords, 40),
    cvText: String(p.cvText ?? '').slice(0, 60000),
  };
}

export async function getProfile(): Promise<Profile> {
  const d = await db();
  const [row] = await d.query<{ data: Partial<Profile>; updated_at: string }>('select data, updated_at from profile where id = 1');
  return { ...sanitizeProfile(row?.data ?? {}), updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : undefined };
}

export async function saveProfile(input: Partial<Profile>): Promise<Profile> {
  const d = await db();
  const clean = sanitizeProfile(input);
  await d.query('update profile set data = $1::jsonb, updated_at = now() where id = 1', [JSON.stringify(clean)]);
  return getProfile();
}

export function sanitizeSettings(input: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...input };
  const delays = Array.isArray(s.followupDelays) ? s.followupDelays.map((n) => clampInt(n, 1, 90, 7)).slice(0, 6) : DEFAULT_SETTINGS.followupDelays;
  return {
    seedColor: /^#[0-9a-f]{6}$/i.test(String(s.seedColor)) ? String(s.seedColor) : DEFAULT_SETTINGS.seedColor,
    themeMode: (['system', 'light', 'dark'] as const).includes(s.themeMode) ? s.themeMode : 'system',
    matchThreshold: clampInt(s.matchThreshold, 0, 100, 65),
    followupDelays: delays.length ? delays : DEFAULT_SETTINGS.followupDelays,
    maxFollowups: clampInt(s.maxFollowups, 0, 10, 3),
    notifyInApp: s.notifyInApp !== false,
    notifyPush: !!s.notifyPush,
    notifyEmail: !!s.notifyEmail,
    emailTo: String(s.emailTo ?? '').slice(0, 200),
    digestOnlyIfNew: s.digestOnlyIfNew !== false,
  };
}

export async function getSettings(): Promise<Settings> {
  const d = await db();
  const [row] = await d.query<{ data: Partial<Settings> }>('select data from settings where id = 1');
  return sanitizeSettings(row?.data ?? {});
}

export async function saveSettings(input: Partial<Settings>): Promise<Settings> {
  const d = await db();
  const merged = sanitizeSettings({ ...(await getSettings()), ...input });
  await d.query('update settings set data = $1::jsonb, updated_at = now() where id = 1', [JSON.stringify(merged)]);
  return merged;
}
