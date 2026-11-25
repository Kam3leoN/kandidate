# KandiDate

Suivi de candidatures, relances, veille d’offres multi-sources et analyse de match — en **Material 3 Expressive** avec ton framework **k3ui** (+ `k3-chart` de **k3ux**).

- **Candidatures** : tableau kanban (glisser-déposer) ou liste filtrable, fiche détaillée avec historique, entretiens, contacts, notes, lettre.
- **Relances** : programmées automatiquement (J+7, J+10, J+14 par défaut, réglables), rappel post-entretien à J+3, modèles d’email générés selon l’étape (avec tes compétences qui matchent), report d’un clic.
- **Veille** : France Travail, Adzuna, Jooble, La bonne alternance, Remotive ; recherche en direct + alertes enregistrées exécutées chaque matin ; dédoublonnage entre sources ; filtres (score, contrat, télétravail, source, date, salaire, rayon, mots exclus, codes ROME).
- **LinkedIn / Cadremploi / APEC / WTTJ / Indeed / HelloWork** : pas d’API publique → import de tes **emails d’alerte** (transfert automatique vers Resend) ou de l’**URL / du texte** d’une annonce. Aucun scraping.
- **Analyse locale** (aucune IA externe) : contrat, durée, télétravail (jours), salaire (k€, mensuel, TJM, format France Travail) annualisé, expérience, séniorité, diplôme, langues, 160+ compétences (+ les tiennes) classées « demandées / appréciées », signaux (avantages, astreintes…), mots-clés ATS absents de ton CV, score de match pondéré sur 7 critères avec niveau de confiance, freins rédhibitoires et conseils.
- **Notifications** : centre in-app (badge), Web Push (PWA, VAPID), récap email quotidien (Resend).
- **Material You** : schéma dynamique depuis une couleur source, clair/sombre/système, typo *emphasized*, formes M3 Expressive (le score morphe de forme selon la bande), mouvements *expressive*.

![Accueil](docs/screenshots/dashboard.png)

## Architecture

```
index.html, src/           Front Vite + Lit (light DOM) + k3ui (entrée lazy, components: 'auto')
  views/                   une vue par route, chargée à la demande
  components/              kd-score (forme qui morphe), kd-analysis, champs (géo, chips)
shared/                    types + moteur d'analyse/matching (utilisé par le navigateur ET l'API)
server/                    API fetch-standard : routes, repo SQL, connecteurs, cron, notify, imports
api/handler.ts             UNE fonction Vercel (plan Hobby : limite de fonctions) ← rewrite /api/*
vendor/k3ui, vendor/k3ux   sous-modules git épinglés (k3ui n'est pas publié sur npm)
```

Base : **Neon Postgres** via `@neondatabase/serverless` (HTTP). Sans `DATABASE_URL`, l’app tourne sur **PGlite** (Postgres WASM) dans `.data/` — pratique en local. Les migrations s’appliquent seules au premier appel (`schema_migrations`), ou via `npm run db:migrate`.

## Démarrer en local

```bash
# depuis le zip : crée le dépôt git + sous-modules k3ui/k3ux épinglés + npm install
./scripts/setup.sh            # Windows : powershell -File scripts/setup.ps1
npm run db:seed               # optionnel : données fictives de démo (refuse Neon sans --force)
npm run dev                   # http://localhost:5173 (l'API /api tourne dans le serveur Vite)
```

Depuis un clone git : `git clone --recurse-submodules …` puis `npm install`.

Tests : `npm test` (moteur d’analyse, connecteurs mockés, parseur d’alertes, API complète sur PGlite) · `npm run typecheck` · `npm run build`.

## Base Neon « KandiDate »

1. Console Neon → projet / base **KandiDate** → *Connection string* (pooled, `sslmode=require`).
2. Mets-la dans `DATABASE_URL` (Vercel + `.env` local si tu veux travailler sur la vraie base).
3. `npm run db:migrate` (ou laisse la migration se faire au premier appel).

## Déploiement Vercel

1. Pousse le dépôt sur GitHub (les sous-modules sont publics : Vercel les récupère).
2. Vercel → *Add New Project* → importe le dépôt (preset **Vite**, rien d’autre à changer : `vercel.json` fournit build, rewrite `/api/*`, cron, en-têtes).
3. Variables d’environnement (voir `.env.example`) — minimum conseillé : `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`.
4. Le cron `0 6 * * *` (UTC ≈ 7 h/8 h à Paris) lance la veille, les rappels et le récap. Plan Hobby : 1 exécution/jour max. Pour plus fréquent : plan Pro (édite `crons`) ou un planificateur externe (cron-job.org…) qui appelle `GET https://ton-app/api/cron/run?secret=CRON_SECRET`.

## Sources d’offres

| Source | Variables | Où obtenir la clé | Remarques |
| --- | --- | --- | --- |
| France Travail | `FRANCE_TRAVAIL_CLIENT_ID`, `FRANCE_TRAVAIL_CLIENT_SECRET` | francetravail.io → créer une application → API « Offres d’emploi v2 » | OAuth2 client credentials, scope `api_offresdemploiv2 o2dsoffre`. Filtres commune (INSEE) + rayon, contrat, date, salaire. |
| Adzuna | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | developer.adzuna.com | Agrège de nombreux job boards ; descriptions tronquées ; salaires « prédits » ignorés. |
| Jooble | `JOOBLE_API_KEY` (`JOOBLE_ENDPOINT` optionnel) | jooble.org/api/about | Quota de requêtes limité par clé : réserve-le surtout aux alertes. |
| La bonne alternance | `LBA_API_TOKEN` (`LBA_API_URL` optionnel) | api.apprentissage.beta.gouv.fr | Recherche par lieu et/ou codes ROME, filtrée ensuite par mots-clés. Vérifie l’URL de la route dans leur Swagger si elle évolue. |
| Remotive | — (`REMOTIVE_DISABLED=1` pour couper) | API publique | 100 % remote, lien Remotive conservé comme demandé par leurs conditions. |
| Alertes email | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `INBOUND_ADDRESS` ou `INBOUND_TOKEN` | resend.com (Receiving) | Voir ci-dessous. |

La localisation utilise geo.api.gouv.fr (sans clé) pour obtenir code INSEE et coordonnées.

### LinkedIn, Cadremploi, APEC… par email

1. Crée tes alertes sur ces sites (emails quotidiens).
2. Resend → *Receiving* : ajoute ton domaine (ou l’adresse `…@…resend.app`) ; *Webhooks* → `https://ton-app/api/inbound/resend`, événement `email.received`, copie le *signing secret* dans `RESEND_WEBHOOK_SECRET`.
3. Dans Gmail/Outlook, règle de transfert automatique des emails d’alerte vers cette adresse.
4. Chaque email reçu est lu (via l’API Resend), les offres sont extraites (titre, entreprise, lieu, lien canonique), scorées et notifiées. Autre fournisseur : `POST /api/inbound/email?token=INBOUND_TOKEN` avec `{ from, subject, html, text }` (Postmark et formats Mailgun acceptés). À la main : Analyse → *Alerte email*.

Ces emails ne contiennent qu’un extrait : pour un score complet, colle le texte de l’annonce dans la candidature (onglet Infos) ou dans Analyse.

## Notifications

- **Push** : `npm run vapid` → `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (+ `VAPID_SUBJECT`). Active-les dans Réglages sur chaque appareil. Sur iPhone : ajoute d’abord l’app à l’écran d’accueil (PWA).
- **Email** : `RESEND_API_KEY` + `EMAIL_FROM` (domaine vérifié chez Resend), puis Réglages → adresse du récap → interrupteur. Boutons de test fournis.

## Score de match

Pondération : compétences 34 · intitulé 20 · expérience 12 · contrat 10 · salaire 10 · lieu & télétravail 10 · langues 4. Un critère que l’annonce ne précise pas est exclu du calcul et baisse la *confiance* (le score est alors tiré vers 50). Un mot exclu, un contrat non souhaité, un salaire très en dessous de ton minimum ou une distance excessive plafonnent le score à 45 %. Le profil (Profil) pilote tout : chaque compétence ajoutée devient détectable dans les annonces, et l’enregistrement du profil re-score toutes les offres stockées.

## Sécurité

Application mono-utilisateur : mot de passe `APP_PASSWORD`, cookie de session HttpOnly signé (HMAC), garde CSRF (JSON obligatoire sur les écritures), cron protégé par `CRON_SECRET`, webhooks signés (Svix) ou à jeton, import d’URL protégé contre les adresses internes. Sans `APP_PASSWORD`, l’accès est libre : à réserver au local.

## Licence

Code de l’app : à toi. k3ui / k3ux : MIT © Kam3leoN.
