import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { CONTRACT_TYPES, SOURCE_LABELS, type ContractType, type NormalizedOffer, type Offer, type SavedSearch, type SourceId } from '../../shared/types.js';
import { LightElement } from '../components/base.js';
import '../components/fields.js';
import { emptyState, loading, offerCard, type AnyOffer } from '../components/offer-card.js';
import { del, get, patch, post } from '../lib/api.js';
import { navigate, setQuery, type Route } from '../lib/router.js';
import { store, StoreController } from '../lib/store.js';
import { closeDialog, debounce, evValue, ic, openDialog, relDays, slotIc, toast, toastError } from '../lib/ui.js';

const TABS = ['inbox', 'saved', 'live', 'alerts'] as const;
type Tab = (typeof TABS)[number];
const LIVE_SOURCES: SourceId[] = ['france_travail', 'adzuna', 'jooble', 'lba', 'remotive'];

const EMPTY_SEARCH: Partial<SavedSearch> = {
  name: '',
  keywords: '',
  location: null,
  radiusKm: 30,
  contracts: ['CDI'],
  remote: 'any',
  salaryMin: null,
  publishedSinceDays: 7,
  sources: [],
  romeCodes: [],
  excludeKeywords: [],
  minScore: 60,
  alert: true,
};

interface LiveResult {
  offers: Array<NormalizedOffer & { matchScore: number }>;
  errors: Array<{ source: string; message: string }>;
  counts: Record<string, number>;
}

@customElement('kd-offers')
export class KdOffers extends LightElement {
  private store = new StoreController(this);
  @property({ attribute: false }) route!: Route;
  @state() private tab: Tab = 'inbox';
  @state() private list: { items: Offer[]; total: number } | null = null;
  @state() private q = '';
  @state() private minScore = 0;
  @state() private contracts: string[] = [];
  @state() private remote = '';
  @state() private sources: string[] = [];
  @state() private sort: 'score' | 'date' = 'score';
  @state() private searchId = 0;
  @state() private page = 0;
  @state() private searches: SavedSearch[] | null = null;
  @state() private draft: Partial<SavedSearch> = { ...EMPTY_SEARCH };
  @state() private live: LiveResult | null = null;
  @state() private liveBusy = false;
  @state() private editing: SavedSearch | null = null;
  @state() private runningId = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    const q = this.route?.query;
    const t = q?.get('tab');
    this.tab = t && (TABS as readonly string[]).includes(t) ? (t as Tab) : 'inbox';
    this.searchId = Number(q?.get('search') ?? 0) || 0;
    this.sources = q?.get('source')?.split(',').filter(Boolean) ?? [];
    void this.loadTab();
  }

  private async loadTab(): Promise<void> {
    if (this.tab === 'inbox' || this.tab === 'saved') await this.loadList();
    if (this.tab === 'alerts' || this.tab === 'live' || this.searches === null) await this.loadSearches();
  }

  private async loadList(): Promise<void> {
    const p = new URLSearchParams({ status: this.tab === 'saved' ? 'saved' : 'inbox', sort: this.sort, limit: '30', offset: String(this.page * 30) });
    if (this.q) p.set('q', this.q);
    if (this.minScore) p.set('minScore', String(this.minScore));
    if (this.contracts.length) p.set('contract', this.contracts.join(','));
    if (this.remote) p.set('remote', this.remote);
    if (this.sources.length) p.set('source', this.sources.join(','));
    if (this.searchId) p.set('search', String(this.searchId));
    try {
      this.list = await get<{ items: Offer[]; total: number }>(`/offers?${p}`);
    } catch (e) {
      toastError(e);
    }
  }

  private async loadSearches(): Promise<void> {
    try {
      this.searches = await get<SavedSearch[]>('/searches');
    } catch (e) {
      toastError(e);
    }
  }

  private refilter = debounce(() => {
    this.page = 0;
    void this.loadList();
  }, 250);

  /* ── Actions on offers ── */

  private async ensureStored(o: AnyOffer, status: Offer['status']): Promise<Offer> {
    if (typeof (o as Offer).id === 'number') {
      await patch(`/offers/${(o as Offer).id}`, { status });
      return o as Offer;
    }
    const stored = await post<Offer>('/offers', { offer: o, status });
    if (this.live) this.live = { ...this.live, offers: this.live.offers.map((x) => (x === o ? { ...x, storedId: stored.id, storedStatus: status } : x)) };
    return stored;
  }

  private handlers = {
    open: async (o: AnyOffer) => {
      try {
        const s = await this.ensureStored(o, 'seen');
        navigate(`/offers/${s.id}`);
      } catch (e) {
        toastError(e);
      }
    },
    save: async (o: AnyOffer) => {
      try {
        await this.ensureStored(o, 'saved');
        toast('Offre sauvegardée', { icon: 'bookmark_added' });
        if (this.tab !== 'live') await this.loadList();
      } catch (e) {
        toastError(e);
      }
    },
    dismiss: async (o: AnyOffer) => {
      try {
        const s = await this.ensureStored(o, 'dismissed');
        toast('Offre ignorée', {
          icon: 'visibility_off',
          action: 'Annuler',
          onAction: async () => {
            await patch(`/offers/${s.id}`, { status: 'seen' });
            await this.loadList();
          },
        });
        if (this.tab !== 'live') await this.loadList();
        else if (this.live) this.live = { ...this.live, offers: this.live.offers.map((x) => (x === o ? { ...x, storedStatus: 'dismissed' } : x)) };
      } catch (e) {
        toastError(e);
      }
    },
    apply: async (o: AnyOffer) => {
      try {
        const s = await this.ensureStored(o, 'saved');
        const app = await post<{ id: number }>(`/offers/${s.id}/apply`, { status: 'wishlist' });
        window.dispatchEvent(new CustomEvent('kd:applications-changed'));
        toast('Ajoutée à « À postuler »', { icon: 'add_task', action: 'Ouvrir', onAction: () => navigate(`/applications/${app.id}`) });
        if (this.tab !== 'live') await this.loadList();
        else if (this.live) this.live = { ...this.live, offers: this.live.offers.map((x) => (x === o ? { ...x, storedId: s.id, storedStatus: 'applied' } : x)) };
      } catch (e) {
        toastError(e);
      }
    },
  };

  /* ── Live search ── */

  private async runLive(): Promise<void> {
    if (!this.draft.keywords?.trim() && !this.draft.romeCodes?.length) return toast('Saisis au moins un mot-clé', { icon: 'error' });
    this.liveBusy = true;
    try {
      this.live = await post<LiveResult>('/search', this.draft);
      if (this.live.errors.length) toast(`${this.live.errors.length} source(s) en erreur`, { icon: 'warning', supportingText: this.live.errors.map((e) => `${SOURCE_LABELS[e.source as SourceId] ?? e.source} : ${e.message}`).join(' · ') });
    } catch (e) {
      toastError(e);
    } finally {
      this.liveBusy = false;
    }
  }

  private async saveAsAlert(): Promise<void> {
    try {
      const s = await post<SavedSearch>('/searches', { ...this.draft, name: this.draft.name || this.draft.keywords });
      toast(`Alerte « ${s.name} » créée — veille quotidienne`, { icon: 'notifications_active' });
      await this.loadSearches();
    } catch (e) {
      toastError(e);
    }
  }

  private async runSearch(s: SavedSearch): Promise<void> {
    this.runningId = s.id;
    try {
      const r = await post<{ inserted: number; matches: number; errors: Array<{ source: string; message: string }> }>(`/searches/${s.id}/run`);
      toast(`${r.inserted} nouvelle(s) offre(s), dont ${r.matches} au-dessus du seuil`, { icon: 'radar', action: r.inserted ? 'Voir' : undefined, onAction: () => this.goSearch(s.id) });
      if (r.errors.length) toast(r.errors.map((e) => `${SOURCE_LABELS[e.source as SourceId] ?? e.source} : ${e.message}`).join(' · '), { icon: 'warning', variant: 'error' });
      await Promise.all([this.loadSearches(), store.refreshUnread()]);
    } catch (e) {
      toastError(e);
    } finally {
      this.runningId = 0;
    }
  }

  private goSearch(id: number): void {
    this.tab = 'inbox';
    this.searchId = id;
    setQuery({ tab: null, search: id });
    void this.loadList();
  }

  /* ── Render ── */

  private renderSearchForm(d: Partial<SavedSearch>, set: (p: Partial<SavedSearch>) => void, compact = false): unknown {
    const sys = this.store.state.system;
    const configured = new Set(sys?.sources.filter((s) => s.configured).map((s) => s.id) ?? []);
    return html`<div class="kd-form">
      <div class="two">
        <k3-text-field variant="outlined" label="Mots-clés (poste, compétence…)" .value=${d.keywords ?? ''} @k3-input=${(e: Event) => set({ keywords: evValue(e) })} @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && !compact && this.runLive()}>${slotIc('leading-icon', 'search')}</k3-text-field>
        <kd-geo-field .value=${d.location ?? null} @kd-change=${(e: CustomEvent) => set({ location: e.detail })}></kd-geo-field>
      </div>
      <div class="two">
        <div>
          <div class="kd-field-label">Rayon : ${d.radiusKm ?? 30} km</div>
          <k3-slider min="0" max="150" step="5" .value=${d.radiusKm ?? 30} aria-label="Rayon" @k3-change=${(e: CustomEvent<{ value: number }>) => set({ radiusKm: e.detail.value })}></k3-slider>
        </div>
        <div class="two" style="gap:.75rem">
          <k3-select variant="outlined" label="Publiées depuis" .value=${String(d.publishedSinceDays ?? 7)} @k3-change=${(e: Event) => set({ publishedSinceDays: Number(evValue(e)) })}>
            ${[1, 3, 7, 14, 31].map((n) => html`<k3-menu-item value=${n}>${n === 1 ? '24 h' : `${n} jours`}</k3-menu-item>`)}
          </k3-select>
          <k3-text-field variant="outlined" type="number" label="Salaire min. (€/an)" .value=${d.salaryMin ? String(d.salaryMin) : ''} @k3-input=${(e: Event) => set({ salaryMin: Number(evValue(e)) || null })}></k3-text-field>
        </div>
      </div>
      <div>
        <div class="kd-field-label">Contrats</div>
        <k3-chip-set selection="multi" label="Contrats" @k3-change=${(e: CustomEvent<{ values: string[] }>) => set({ contracts: e.detail.values as ContractType[] })}>
          ${CONTRACT_TYPES.map((c) => html`<k3-chip variant="filter" value=${c} ?selected=${d.contracts?.includes(c)}>${c}</k3-chip>`)}
        </k3-chip-set>
      </div>
      <div class="two">
        <div>
          <div class="kd-field-label">Télétravail</div>
          <k3-button-segmented
            aria-label="Télétravail"
            .segments=${[
              { label: 'Peu importe', value: 'any' },
              { label: 'Hybride', value: 'hybrid', icon: 'home_work' },
              { label: '100 %', value: 'full', icon: 'cottage' },
            ]}
            .selectedIndices=${[['any', 'hybrid', 'full'].indexOf(d.remote ?? 'any')]}
            @k3-change=${(e: CustomEvent<{ values: string[] }>) => set({ remote: (e.detail.values[0] as SavedSearch['remote']) ?? 'any' })}
          ></k3-button-segmented>
        </div>
        <div>
          <div class="kd-field-label">Sources ${d.sources?.length ? '' : html`<span class="muted">(toutes celles configurées)</span>`}</div>
          <k3-chip-set selection="multi" label="Sources" @k3-change=${(e: CustomEvent<{ values: string[] }>) => set({ sources: e.detail.values as SourceId[] })}>
            ${LIVE_SOURCES.map(
              (s) => html`<k3-chip variant="filter" value=${s} ?selected=${d.sources?.includes(s)} ?disabled=${sys ? !configured.has(s) : false} title=${configured.has(s) ? '' : 'Non configurée (Réglages → Sources)'}>${SOURCE_LABELS[s]}</k3-chip>`,
            )}
          </k3-chip-set>
        </div>
      </div>
      <details>
        <summary class="t-label" style="cursor:pointer">Options avancées</summary>
        <div class="kd-form" style="margin-top:1rem">
          <div class="two">
            <kd-chips-input label="Codes ROME (ex. M1805)" icon="tag" .values=${d.romeCodes ?? []} @kd-change=${(e: CustomEvent<string[]>) => set({ romeCodes: e.detail })}></kd-chips-input>
            <kd-chips-input label="Mots à exclure" icon="block" .values=${d.excludeKeywords ?? []} @kd-change=${(e: CustomEvent<string[]>) => set({ excludeKeywords: e.detail })}></kd-chips-input>
          </div>
          <div>
            <div class="kd-field-label">Score minimum pour être alerté : ${d.minScore ?? 60} %</div>
            <k3-slider min="0" max="100" step="5" .value=${d.minScore ?? 60} aria-label="Score minimum" @k3-change=${(e: CustomEvent<{ value: number }>) => set({ minScore: e.detail.value })}></k3-slider>
          </div>
        </div>
      </details>
    </div>`;
  }

  private renderLive(): unknown {
    const sys = this.store.state.system;
    const configured = sys?.sources.filter((s) => s.configured && LIVE_SOURCES.includes(s.id)) ?? [];
    return html`<section class="kd-surface" style="margin-bottom:var(--kd-gap)">
        ${sys && configured.length <= 1
          ? html`<k3-alert variant="info" label="Branche tes sources" style="margin-bottom:1rem">
              ${configured.length ? `Seule « ${configured[0].label} » est active.` : 'Aucune source n’est configurée.'} Ajoute tes clés France Travail, Adzuna, Jooble… dans les variables d’environnement.
              <k3-button slot="action" variant="text" size="sm" @click=${() => navigate('/settings')}>Voir</k3-button>
            </k3-alert>`
          : nothing}
        ${this.renderSearchForm(this.draft, (p) => (this.draft = { ...this.draft, ...p }))}
        <div class="row" style="margin-top:1.25rem;justify-content:flex-end">
          <k3-button variant="tonal" @click=${() => this.saveAsAlert()}>${slotIc('icon', 'notifications_active')}Créer une alerte</k3-button>
          <k3-button variant="filled" size="md" ?disabled=${this.liveBusy} @click=${() => this.runLive()}>${slotIc('icon', 'travel_explore')}${this.liveBusy ? 'Recherche…' : 'Rechercher'}</k3-button>
        </div>
      </section>
      ${this.liveBusy
        ? loading()
        : this.live
          ? html`<div class="row" style="margin-bottom:.75rem">
                <span class="t-title-m">${this.live.offers.length} offre${this.live.offers.length > 1 ? 's' : ''}</span>
                ${Object.entries(this.live.counts).map(([s, n]) => html`<span class="kd-tag outline">${SOURCE_LABELS[s as SourceId] ?? s} · ${n}</span>`)}
                ${this.live.errors.map((e) => html`<span class="kd-tag error" title=${e.message}>${ic('error')}${SOURCE_LABELS[e.source as SourceId] ?? e.source}</span>`)}
              </div>
              ${this.live.offers.length
                ? html`<div class="stack tight kd-stagger">${this.live.offers.map((o) => offerCard(o, this.handlers))}</div>`
                : emptyState('search_off', 'Aucun résultat', 'Élargis le rayon, la période ou les contrats.')}`
          : nothing}`;
  }

  private renderList(): unknown {
    const l = this.list;
    const search = this.searches?.find((s) => s.id === this.searchId);
    return html`<div class="kd-filters">
        <k3-search placeholder="Filtrer par titre, entreprise, lieu…" .value=${this.q} @k3-input=${(e: Event) => {
          this.q = evValue(e);
          this.refilter();
        }}></k3-search>
        <k3-select variant="outlined" label="Tri" style="width:11rem" .value=${this.sort} @k3-change=${(e: Event) => {
          this.sort = evValue(e) as 'score' | 'date';
          this.refilter();
        }}>
          <k3-menu-item value="score">Meilleur match</k3-menu-item>
          <k3-menu-item value="date">Plus récentes</k3-menu-item>
        </k3-select>
      </div>
      <div class="kd-filter-panel">
        <div>
          <div class="kd-field-label">Score minimum : ${this.minScore} %</div>
          <k3-slider min="0" max="100" step="5" .value=${this.minScore} aria-label="Score minimum" @k3-change=${(e: CustomEvent<{ value: number }>) => {
            this.minScore = e.detail.value;
            this.refilter();
          }}></k3-slider>
        </div>
        <k3-chip-set selection="multi" label="Contrats" @k3-change=${(e: CustomEvent<{ values: string[] }>) => {
          this.contracts = e.detail.values;
          this.refilter();
        }}>
          ${CONTRACT_TYPES.slice(0, 4).map((c) => html`<k3-chip variant="filter" value=${c} ?selected=${this.contracts.includes(c)}>${c}</k3-chip>`)}
        </k3-chip-set>
        <k3-chip-set selection="single" label="Télétravail" @k3-change=${(e: CustomEvent<{ values: string[] }>) => {
          this.remote = e.detail.values[0] ?? '';
          this.refilter();
        }}>
          <k3-chip variant="filter" value="hybrid" ?selected=${this.remote === 'hybrid'}>${slotIc('icon', 'home_work')}Télétravail possible</k3-chip>
          <k3-chip variant="filter" value="full" ?selected=${this.remote === 'full'}>${slotIc('icon', 'cottage')}100 % remote</k3-chip>
        </k3-chip-set>
        <k3-chip-set selection="multi" label="Sources" @k3-change=${(e: CustomEvent<{ values: string[] }>) => {
          this.sources = e.detail.values;
          this.refilter();
        }}>
          ${(['france_travail', 'adzuna', 'jooble', 'lba', 'remotive', 'email', 'import'] as SourceId[]).map((s) => html`<k3-chip variant="filter" value=${s} ?selected=${this.sources.includes(s)}>${SOURCE_LABELS[s]}</k3-chip>`)}
        </k3-chip-set>
      </div>
      ${search
        ? html`<div class="row" style="margin-bottom:1rem"><k3-chip variant="input" removable @k3-remove=${() => {
            this.searchId = 0;
            setQuery({ search: null });
            this.refilter();
          }}>${slotIc('icon', 'notifications_active')}Alerte : ${search.name}</k3-chip></div>`
        : nothing}
      ${l === null
        ? loading()
        : l.items.length
          ? html`<div class="row between" style="margin-bottom:.75rem">
                <span class="muted">${l.total} offre${l.total > 1 ? 's' : ''}</span>
                ${this.tab === 'inbox' && l.items.some((o) => o.status === 'new')
                  ? html`<k3-button variant="text" size="sm" @click=${async () => {
                      await post('/offers/bulk', { ids: l.items.filter((o) => o.status === 'new').map((o) => o.id), status: 'seen' });
                      await this.loadList();
                    }}>${slotIc('icon', 'done_all')}Tout marquer comme vu</k3-button>`
                  : nothing}
              </div>
              <div class="stack tight kd-stagger">${l.items.map((o) => offerCard(o, this.handlers))}</div>
              ${l.total > 30
                ? html`<div class="row" style="justify-content:center;margin-top:1.25rem">
                    <k3-pagination .count=${Math.ceil(l.total / 30)} .page=${this.page + 1} @k3-change=${(e: CustomEvent<{ page: number }>) => {
                      this.page = (e.detail.page ?? 1) - 1;
                      void this.loadList();
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}></k3-pagination>
                  </div>`
                : nothing}`
          : this.tab === 'saved'
            ? emptyState('bookmarks', 'Aucune offre sauvegardée', 'Utilise le signet sur une offre pour la garder sous le coude.')
            : emptyState('inbox', 'Boîte de réception vide', 'Crée une alerte ou lance une recherche : les nouvelles offres arrivent ici, triées par score de match.', html`<k3-button variant="filled" @click=${() => this.switchTab('alerts')}>${slotIc('icon', 'add_alert')}Créer une alerte</k3-button>`)}`;
  }

  private renderAlerts(): unknown {
    const list = this.searches;
    return html`<div class="row between" style="margin-bottom:1rem">
        <p class="muted" style="max-width:44rem">Chaque alerte est exécutée par la veille quotidienne (cron). Les nouvelles offres au-dessus du score minimum déclenchent une notification (in-app, push, email).</p>
        <k3-button variant="filled" @click=${async () => {
          this.editing = { ...(EMPTY_SEARCH as SavedSearch), id: 0 };
          await this.updateComplete;
          await openDialog(this, 'dlg-search');
        }}>${slotIc('icon', 'add_alert')}Nouvelle alerte</k3-button>
      </div>
      ${list === null
        ? loading()
        : list.length
          ? html`<div class="kd-grid cols-2 kd-stagger">
              ${list.map(
                (s) => html`<section class="kd-surface stack">
                  <div class="row nowrap between">
                    <div style="min-width:0">
                      <div class="t-title ellipsis">${s.name}</div>
                      <div class="muted ellipsis">${[s.keywords, s.location?.label, s.location ? `${s.radiusKm} km` : ''].filter(Boolean).join(' · ')}</div>
                    </div>
                    <k3-switch ?selected=${s.alert} aria-label="Alerte active" @k3-change=${async (e: CustomEvent<{ selected: boolean }>) => {
                      await patch(`/searches/${s.id}`, { alert: e.detail.selected });
                      toast(e.detail.selected ? 'Alerte activée' : 'Alerte en pause', { icon: e.detail.selected ? 'notifications_active' : 'notifications_paused' });
                      await this.loadSearches();
                    }}></k3-switch>
                  </div>
                  <div class="row">
                    ${s.contracts.map((c) => html`<span class="kd-tag">${c}</span>`)}
                    ${s.remote !== 'any' ? html`<span class="kd-tag secondary">${s.remote === 'full' ? '100 % remote' : 'Hybride'}</span>` : nothing}
                    <span class="kd-tag outline">≥ ${s.minScore} %</span>
                    <span class="kd-tag outline">${s.publishedSinceDays === 1 ? '24 h' : `${s.publishedSinceDays} j`}</span>
                    ${(s.sources.length ? s.sources : ['toutes sources']).map((x) => html`<span class="kd-tag outline">${SOURCE_LABELS[x as SourceId] ?? x}</span>`)}
                  </div>
                  <div class="kd-hint">${s.lastRunAt ? `Dernière exécution ${relDays(s.lastRunAt)} · ${s.lastNewCount ?? 0} nouvelle(s)` : 'Jamais exécutée'}</div>
                  <div class="row">
                    <k3-button variant="tonal" size="sm" ?disabled=${this.runningId === s.id} @click=${() => this.runSearch(s)}>${slotIc('icon', 'play_arrow')}${this.runningId === s.id ? 'En cours…' : 'Lancer'}</k3-button>
                    <k3-button variant="text" size="sm" @click=${() => this.goSearch(s.id)}>${slotIc('icon', 'inbox')}Offres</k3-button>
                    <span class="grow"></span>
                    <k3-icon-button variant="standard" label="Modifier" @click=${async () => {
                      this.editing = { ...s };
                      await this.updateComplete;
                      await openDialog(this, 'dlg-search');
                    }}>${ic('edit')}</k3-icon-button>
                    <k3-icon-button variant="standard" label="Supprimer" @click=${async () => {
                      await del(`/searches/${s.id}`);
                      toast('Alerte supprimée', { icon: 'delete' });
                      await this.loadSearches();
                    }}>${ic('delete')}</k3-icon-button>
                  </div>
                </section>`,
              )}
            </div>`
          : emptyState('notifications_none', 'Aucune alerte', 'Une alerte = une recherche enregistrée que KandiDate relance chaque jour sur toutes tes sources.')}
      <k3-dialog id="dlg-search">
        <span slot="icon" class="ms" data-k3-icon="notifications_active" aria-hidden="true"></span>
        <span slot="headline">${this.editing?.id ? 'Modifier l’alerte' : 'Nouvelle alerte'}</span>
        <div class="kd-dialog-body" style="min-width:min(46rem,86vw)">
          ${this.editing
            ? html`<k3-text-field variant="outlined" label="Nom de l’alerte" .value=${this.editing.name ?? ''} @k3-input=${(e: Event) => (this.editing = { ...this.editing!, name: evValue(e) })}></k3-text-field>
                ${this.renderSearchForm(this.editing, (p) => (this.editing = { ...this.editing!, ...p }), true)}`
            : nothing}
        </div>
        <k3-button slot="actions" variant="text" @click=${() => closeDialog(this, 'dlg-search')}>Annuler</k3-button>
        <k3-button slot="actions" variant="filled" @click=${async () => {
          try {
            const e = this.editing!;
            if (e.id) await patch(`/searches/${e.id}`, e);
            else await post('/searches', e);
            await closeDialog(this, 'dlg-search');
            toast('Alerte enregistrée', { icon: 'check_circle' });
            await this.loadSearches();
          } catch (err) {
            toastError(err);
          }
        }}>Enregistrer</k3-button>
      </k3-dialog>`;
  }

  private switchTab(t: Tab): void {
    this.tab = t;
    this.page = 0;
    setQuery({ tab: t === 'inbox' ? null : t });
    void this.loadTab();
  }

  protected override render(): unknown {
    return html`<div class="kd-page">
      <header class="kd-page-head">
        <div>
          <div class="t-overline">Veille</div>
          <h1 class="t-display">Offres</h1>
        </div>
        <div class="actions">
          <k3-button variant="tonal" @click=${() => navigate('/analyze')}>${slotIc('icon', 'add_link')}Importer une annonce</k3-button>
        </div>
      </header>
      <k3-tabs
        class="kd-tabs"
        variant="primary"
        labels="Boîte de réception,Sauvegardées,Recherche,Alertes"
        icons="inbox,bookmarks,travel_explore,notifications_active"
        .index=${TABS.indexOf(this.tab)}
        @k3-change=${(e: CustomEvent<{ index: number }>) => this.switchTab(TABS[e.detail.index] ?? 'inbox')}
      ></k3-tabs>
      ${this.tab === 'live' ? this.renderLive() : this.tab === 'alerts' ? this.renderAlerts() : this.renderList()}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kd-offers': KdOffers;
  }
}
