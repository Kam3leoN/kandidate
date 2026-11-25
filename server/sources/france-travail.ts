/**
 * France Travail — API Offres d'emploi v2 (francetravail.io, OAuth2 client credentials).
 * Docs: https://francetravail.io/data/api/offres-emploi
 */
import type { ContractType, NormalizedOffer } from '../../shared/types.js';
import { fetchJson, keywordTerms, SourceError, type Connector, type SearchQuery } from './common.js';

const TOKEN_URL = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
const SEARCH_URL = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';
const SCOPE = 'api_offresdemploiv2 o2dsoffre';

let token: { value: string; exp: number } | null = null;

async function getToken(): Promise<string> {
  if (token && token.exp > Date.now() + 30_000) return token.value;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.FRANCE_TRAVAIL_CLIENT_ID ?? '',
    client_secret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET ?? '',
    scope: SCOPE,
  });
  const { data } = await fetchJson<{ access_token: string; expires_in: number }>('france_travail', TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!data?.access_token) throw new SourceError('france_travail', 'Jeton OAuth non reçu');
  token = { value: data.access_token, exp: Date.now() + (data.expires_in ?? 1400) * 1000 };
  return token.value;
}

const CONTRACT_TO_FT: Partial<Record<ContractType, string>> = { CDI: 'CDI', CDD: 'CDD', 'Intérim': 'MIS', Freelance: 'LIB' };
const FT_TO_CONTRACT: Record<string, ContractType> = { CDI: 'CDI', CDD: 'CDD', MIS: 'Intérim', LIB: 'Freelance', SAI: 'CDD', TTI: 'Intérim', DDI: 'CDI', DDT: 'CDD', CCE: 'Freelance', FRA: 'Freelance' };

interface FtOffer {
  id: string;
  intitule: string;
  description?: string;
  dateCreation?: string;
  dateActualisation?: string;
  lieuTravail?: { libelle?: string; latitude?: number; longitude?: number; codePostal?: string };
  entreprise?: { nom?: string; description?: string };
  typeContrat?: string;
  typeContratLibelle?: string;
  natureContrat?: string;
  alternance?: boolean;
  experienceLibelle?: string;
  competences?: Array<{ libelle?: string; exigence?: string }>;
  qualitesProfessionnelles?: Array<{ libelle?: string }>;
  formations?: Array<{ niveauLibelle?: string; domaineLibelle?: string; exigence?: string }>;
  langues?: Array<{ libelle?: string; exigence?: string }>;
  salaire?: { libelle?: string; commentaire?: string; complement1?: string; complement2?: string };
  dureeTravailLibelle?: string;
  origineOffre?: { urlOrigine?: string };
}

function toDescription(o: FtOffer): string {
  const parts = [o.description ?? ''];
  const need = (e?: string): string => (e === 'S' ? ' (souhaité)' : '');
  if (o.competences?.length) parts.push(`Compétences :\n${o.competences.map((c) => `• ${c.libelle}${need(c.exigence)}`).join('\n')}`);
  if (o.experienceLibelle) parts.push(`Expérience : ${o.experienceLibelle}`);
  if (o.formations?.length) parts.push(`Formation : ${o.formations.map((f) => [f.niveauLibelle, f.domaineLibelle].filter(Boolean).join(' ')).join(', ')}`);
  if (o.langues?.length) parts.push(`Langues : ${o.langues.map((l) => `${l.libelle}${need(l.exigence)}`).join(', ')}`);
  if (o.qualitesProfessionnelles?.length) parts.push(`Savoir-être : ${o.qualitesProfessionnelles.map((q) => q.libelle).join(', ')}`);
  if (o.salaire?.libelle) parts.push(`Salaire : ${[o.salaire.libelle, o.salaire.commentaire, o.salaire.complement1, o.salaire.complement2].filter(Boolean).join(' · ')}`);
  if (o.dureeTravailLibelle) parts.push(`Durée : ${o.dureeTravailLibelle}`);
  if (o.entreprise?.description) parts.push(`L'entreprise :\n${o.entreprise.description}`);
  return parts.filter(Boolean).join('\n\n');
}

export const franceTravail: Connector = {
  id: 'france_travail',
  label: 'France Travail',
  needs: ['FRANCE_TRAVAIL_CLIENT_ID', 'FRANCE_TRAVAIL_CLIENT_SECRET'],
  note: 'API officielle « Offres d’emploi v2 » — gratuite, application à déclarer sur francetravail.io.',
  configured: () => !!(process.env.FRANCE_TRAVAIL_CLIENT_ID && process.env.FRANCE_TRAVAIL_CLIENT_SECRET),
  async search(q: SearchQuery): Promise<NormalizedOffer[]> {
    const p = new URLSearchParams();
    const terms = keywordTerms(q.keywords);
    if (terms.length) p.set('motsCles', terms.join(','));
    if (q.romeCodes?.length) p.set('codeROME', q.romeCodes.slice(0, 3).join(','));
    if (q.location?.insee) {
      p.set('commune', q.location.insee);
      p.set('distance', String(Math.min(200, q.radiusKm ?? 30)));
    } else if (q.location?.dept) p.set('departement', q.location.dept);
    const ft = (q.contracts ?? []).map((c) => CONTRACT_TO_FT[c]).filter(Boolean) as string[];
    if (ft.length) p.set('typeContrat', ft.join(','));
    if (q.contracts?.length === 1 && q.contracts[0] === 'Alternance') p.set('natureContrat', 'E2,FS');
    const days = q.publishedSinceDays ?? 7;
    p.set('publieeDepuis', String([1, 3, 7, 14, 31].find((d) => d >= days) ?? 31));
    if (q.salaryMin) {
      p.set('salaireMin', String(q.salaryMin));
      p.set('periodeSalaire', 'A');
    }
    p.set('sort', '1');
    p.set('range', `0-${Math.min(149, (q.limit ?? 50) - 1)}`);
    const auth = await getToken();
    const { data } = await fetchJson<{ resultats?: FtOffer[] }>('france_travail', `${SEARCH_URL}?${p}`, {
      headers: { authorization: `Bearer ${auth}` },
    });
    return (data?.resultats ?? []).map((o) => ({
      source: 'france_travail',
      sourceId: o.id,
      url: o.origineOffre?.urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
      title: o.intitule,
      company: o.entreprise?.nom ?? '',
      location: o.lieuTravail?.libelle ?? '',
      lat: o.lieuTravail?.latitude ?? null,
      lon: o.lieuTravail?.longitude ?? null,
      contract: o.alternance ? 'Alternance' : (FT_TO_CONTRACT[o.typeContrat ?? ''] ?? null),
      remote: null,
      salaryText: o.salaire?.libelle ?? '',
      description: toDescription(o),
      publishedAt: o.dateActualisation ?? o.dateCreation ?? null,
    }));
  },
};
