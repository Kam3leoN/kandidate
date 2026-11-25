/** Domain types shared by the browser app and the API. */

export type ContractType = 'CDI' | 'CDD' | 'Freelance' | 'Intérim' | 'Alternance' | 'Stage';
export const CONTRACT_TYPES: ContractType[] = ['CDI', 'CDD', 'Freelance', 'Intérim', 'Alternance', 'Stage'];

export type RemoteMode = 'onsite' | 'hybrid' | 'full';
export type RemotePref = 'any' | 'onsite' | 'hybrid' | 'remote';

export type SourceId = 'france_travail' | 'adzuna' | 'jooble' | 'lba' | 'remotive' | 'import' | 'email';

export const SOURCE_LABELS: Record<SourceId, string> = {
  france_travail: 'France Travail',
  adzuna: 'Adzuna',
  jooble: 'Jooble',
  lba: 'La bonne alternance',
  remotive: 'Remotive',
  import: 'Import manuel',
  email: 'Alerte email',
};

export type AppStatus =
  | 'wishlist'
  | 'applied'
  | 'followup'
  | 'interview'
  | 'offer'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

export const APP_STATUSES: Array<{ id: AppStatus; label: string; icon: string; open: boolean }> = [
  { id: 'wishlist', label: 'À postuler', icon: 'bookmark', open: true },
  { id: 'applied', label: 'Envoyée', icon: 'send', open: true },
  { id: 'followup', label: 'Relancée', icon: 'forward_to_inbox', open: true },
  { id: 'interview', label: 'Entretien', icon: 'groups', open: true },
  { id: 'offer', label: 'Proposition', icon: 'handshake', open: true },
  { id: 'hired', label: 'Acceptée', icon: 'celebration', open: false },
  { id: 'rejected', label: 'Refusée', icon: 'block', open: false },
  { id: 'withdrawn', label: 'Abandonnée', icon: 'archive', open: false },
];

export interface ProfileSkill {
  name: string;
  /** 1 (notions) → 5 (expert) */
  level: number;
  /** Core skills weigh more in the title / skills score. */
  core?: boolean;
}

export interface ProfileLanguage {
  name: string;
  level: 'notions' | 'intermédiaire' | 'courant' | 'bilingue' | 'natif';
}

export interface GeoPoint {
  label: string;
  insee?: string;
  dept?: string;
  lat?: number;
  lon?: number;
}

export interface Profile {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: GeoPoint | null;
  mobilityKm: number;
  remotePref: RemotePref;
  contracts: ContractType[];
  salaryMin: number | null;
  salaryTarget: number | null;
  experienceYears: number;
  educationLevel: number | null;
  targetTitles: string[];
  skills: ProfileSkill[];
  languages: ProfileLanguage[];
  excludedKeywords: string[];
  cvText: string;
  updatedAt?: string;
}

export const EMPTY_PROFILE: Profile = {
  fullName: '',
  headline: '',
  email: '',
  phone: '',
  location: null,
  mobilityKm: 30,
  remotePref: 'any',
  contracts: ['CDI'],
  salaryMin: null,
  salaryTarget: null,
  experienceYears: 0,
  educationLevel: null,
  targetTitles: [],
  skills: [],
  languages: [],
  excludedKeywords: [],
  cvText: '',
};

export interface Settings {
  seedColor: string;
  themeMode: 'system' | 'light' | 'dark';
  matchThreshold: number;
  followupDelays: number[];
  maxFollowups: number;
  notifyInApp: boolean;
  notifyPush: boolean;
  notifyEmail: boolean;
  emailTo: string;
  digestOnlyIfNew: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  seedColor: '#6750A4',
  themeMode: 'system',
  matchThreshold: 65,
  followupDelays: [7, 10, 14],
  maxFollowups: 3,
  notifyInApp: true,
  notifyPush: false,
  notifyEmail: false,
  emailTo: '',
  digestOnlyIfNew: true,
};

export interface Offer {
  id: number;
  source: SourceId;
  sourceId: string;
  url: string;
  title: string;
  company: string;
  location: string;
  lat: number | null;
  lon: number | null;
  contract: ContractType | null;
  remote: RemoteMode | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryText: string;
  description: string;
  publishedAt: string | null;
  fetchedAt: string;
  status: 'new' | 'seen' | 'saved' | 'dismissed' | 'applied';
  matchScore: number | null;
  searchId: number | null;
  applicationId?: number | null;
  analysis?: unknown;
  match?: unknown;
}

/** An offer as returned by a connector before it is stored. */
export interface NormalizedOffer {
  source: SourceId;
  sourceId: string;
  url: string;
  title: string;
  company: string;
  location: string;
  lat?: number | null;
  lon?: number | null;
  contract?: ContractType | null;
  remote?: RemoteMode | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryText?: string;
  description: string;
  publishedAt?: string | null;
  /** Filled by the API after scoring. */
  matchScore?: number;
  match?: unknown;
  /** Filled by the API: the stored offer, if any. */
  storedId?: number | null;
  storedStatus?: Offer['status'] | null;
}

export interface SavedSearch {
  id: number;
  name: string;
  keywords: string;
  location: GeoPoint | null;
  radiusKm: number;
  contracts: ContractType[];
  remote: 'any' | 'hybrid' | 'full';
  /** Desired salary floor (€/year). */
  salaryMin: number | null;
  /** Desired salary ceiling (€/year). */
  salaryMax: number | null;
  publishedSinceDays: number;
  sources: SourceId[];
  romeCodes: string[];
  excludeKeywords: string[];
  minScore: number;
  alert: boolean;
  lastRunAt: string | null;
  lastNewCount: number | null;
  createdAt: string;
}

export interface Application {
  id: number;
  offerId: number | null;
  title: string;
  company: string;
  location: string;
  url: string;
  source: SourceId | null;
  contract: ContractType | null;
  salaryText: string;
  status: AppStatus;
  priority: 1 | 2 | 3;
  matchScore: number | null;
  appliedAt: string | null;
  nextFollowupAt: string | null;
  followupCount: number;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactRole: string;
  notes: string;
  coverLetter: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  lastEventAt?: string | null;
  nextInterviewAt?: string | null;
}

export type EventType = 'created' | 'status' | 'note' | 'followup' | 'interview' | 'email' | 'call' | 'reminder';

export interface AppEvent {
  id: number;
  applicationId: number;
  type: EventType;
  title: string;
  body: string;
  at: string;
  meta: Record<string, unknown>;
}

export type NotificationKind = 'offer_match' | 'followup_due' | 'interview_soon' | 'import' | 'digest' | 'system';

export interface AppNotification {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  url: string;
  readAt: string | null;
  createdAt: string;
  meta: Record<string, unknown>;
}

export interface SourceStatus {
  id: SourceId;
  label: string;
  configured: boolean;
  needs: string[];
  note: string;
}
