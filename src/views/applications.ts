import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { APP_STATUSES, type AppStatus, type Application } from '../../shared/types.js';
import { LightElement } from '../components/base.js';
import { emptyState, loading } from '../components/offer-card.js';
import '../components/score.js';
import { get, patch } from '../lib/api.js';
import { navigate, setQuery, type Route } from '../lib/router.js';
import { daysUntil, debounce, evValue, fmtDate, ic, relDays, slotIc, sourceLabel, statusMeta, toast, toastError } from '../lib/ui.js';

const BOARD: AppStatus[] = ['wishlist', 'applied', 'followup', 'interview', 'offer'];
const CLOSED: AppStatus[] = ['hired', 'rejected', 'withdrawn'];

@customElement('kd-applications')
export class KdApplications extends LightElement {
  @property({ attribute: false }) route!: Route;
  @state() private items: Application[] | null = null;
  @state() private view: 'board' | 'list' = 'board';
  @state() private q = '';
  @state() private statusFilter: string[] = [];
  @state() private showClosed = false;
  @state() private dragOver: AppStatus | null = null;
  private dragId: number | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    const q = this.route?.query;
    const saved = localStorage.getItem('kd.apps.view') as 'board' | 'list' | null;
    this.view = q?.get('view') === 'list' || q?.get('status') ? 'list' : saved || (matchMedia('(max-width: 599.98px)').matches ? 'list' : 'board');
    this.statusFilter = q?.get('status')?.split(',').filter(Boolean) ?? [];
    void this.load();
    window.addEventListener('kd:applications-changed', this.reload);
  }
  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('kd:applications-changed', this.reload);
  }
  private reload = (): void => void this.load();

  private async load(): Promise<void> {
    try {
      this.items = await get<Application[]>(`/applications${this.q ? `?q=${encodeURIComponent(this.q)}` : ''}`);
    } catch (e) {
      toastError(e);
    }
  }

  private searchDebounced = debounce(() => void this.load(), 250);

  private async move(id: number, status: AppStatus): Promise<void> {
    const a = this.items?.find((x) => x.id === id);
    if (!a || a.status === status) return;
    const prev = a.status;
    this.items = this.items!.map((x) => (x.id === id ? { ...x, status } : x));
    try {
      const updated = await patch<Application>(`/applications/${id}`, { status });
      this.items = this.items!.map((x) => (x.id === id ? updated : x));
      toast(`« ${a.title} » → ${statusMeta(status).label}`, {
        icon: statusMeta(status).icon,
        action: 'Annuler',
        onAction: () => void this.move(id, prev),
      });
    } catch (e) {
      this.items = this.items!.map((x) => (x.id === id ? { ...x, status: prev } : x));
      toastError(e);
    }
  }

  private dueChip(a: Application): unknown {
    if (a.nextInterviewAt) return html`<span class="kd-tag tertiary">${ic('groups')}${fmtDate(a.nextInterviewAt, true)}</span>`;
    const d = daysUntil(a.nextFollowupAt);
    if (d == null) return nothing;
    if (d < 0) return html`<span class="kd-tag error">${ic('alarm')}Relance en retard (${-d} j)</span>`;
    if (d === 0) return html`<span class="kd-tag warning">${ic('alarm')}Relancer aujourd’hui</span>`;
    return html`<span class="kd-tag outline">${ic('alarm')}Relance ${relDays(a.nextFollowupAt)}</span>`;
  }

  private card(a: Application): unknown {
    return html`<a
      class="kd-card-app ${this.dragId === a.id ? 'dragging' : ''}"
      href="#/applications/${a.id}"
      draggable="true"
      @dragstart=${(e: DragEvent) => {
        this.dragId = a.id;
        e.dataTransfer?.setData('text/plain', String(a.id));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        this.requestUpdate();
      }}
      @dragend=${() => {
        this.dragId = null;
        this.dragOver = null;
      }}
    >
      <div class="top">
        <div style="flex:1;min-width:0">
          <div class="title">${a.title}</div>
          <div class="company">${[a.company, a.location].filter(Boolean).join(' · ') || '—'}</div>
        </div>
        ${a.matchScore != null ? html`<kd-score size="s" .value=${a.matchScore}></kd-score>` : nothing}
      </div>
      <div class="foot">
        ${this.dueChip(a)}
        ${a.contract ? html`<span class="kd-tag">${a.contract}</span>` : nothing}
        ${a.followupCount ? html`<span class="kd-tag outline">${ic('forward_to_inbox')}${a.followupCount}</span>` : nothing}
        <span class="kd-prio" title="Priorité ${a.priority}/3">${[1, 2, 3].map((i) => html`<i class=${i <= a.priority ? 'on' : ''}></i>`)}</span>
      </div>
    </a>`;
  }

  private column(status: AppStatus, list: Application[]): unknown {
    const meta = statusMeta(status);
    return html`<section
      class="kd-col ${this.dragOver === status ? 'drop' : ''}"
      aria-label=${meta.label}
      @dragover=${(e: DragEvent) => {
        e.preventDefault();
        if (this.dragOver !== status) this.dragOver = status;
      }}
      @dragleave=${(e: DragEvent) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) this.dragOver = null;
      }}
      @drop=${(e: DragEvent) => {
        e.preventDefault();
        const id = Number(e.dataTransfer?.getData('text/plain'));
        this.dragOver = null;
        if (id) void this.move(id, status);
      }}
    >
      <header class="kd-col-head">${ic(meta.icon)}<span class="t-title-m">${meta.label}</span><span class="count">${list.length}</span></header>
      ${list.map((a) => this.card(a))}
      ${status === 'wishlist'
        ? html`<k3-button variant="text" size="sm" style="width:100%" @click=${() => window.dispatchEvent(new CustomEvent('kd:new-application', { detail: { status: 'wishlist' } }))}>${slotIc('icon', 'add')}Ajouter</k3-button>`
        : nothing}
    </section>`;
  }

  private renderBoard(items: Application[]): unknown {
    const closed = items.filter((a) => CLOSED.includes(a.status));
    return html`<div class="kd-board">${BOARD.map((s) => this.column(s, items.filter((a) => a.status === s)))}</div>
      <div class="row" style="margin-top:.5rem">
        <k3-button variant="text" @click=${() => (this.showClosed = !this.showClosed)}>${slotIc('icon', this.showClosed ? 'expand_less' : 'expand_more')}Clôturées (${closed.length})</k3-button>
      </div>
      ${this.showClosed ? html`<div class="kd-board" style="grid-auto-columns:minmax(17rem,22rem)">${CLOSED.map((s) => this.column(s, items.filter((a) => a.status === s)))}</div>` : nothing}`;
  }

  private renderList(items: Application[]): unknown {
    const list = this.statusFilter.length ? items.filter((a) => this.statusFilter.includes(a.status)) : items;
    return html`<k3-chip-set selection="multi" label="Filtrer par statut" style="margin-bottom:1rem"
        @k3-change=${(e: CustomEvent<{ values: string[] }>) => {
          this.statusFilter = e.detail.values;
          setQuery({ status: this.statusFilter.join(',') || null });
        }}>
        ${APP_STATUSES.map((s) => html`<k3-chip variant="filter" value=${s.id} ?selected=${this.statusFilter.includes(s.id)}>${s.label} · ${items.filter((a) => a.status === s.id).length}</k3-chip>`)}
      </k3-chip-set>
      ${list.length
        ? html`<div class="kd-list kd-stagger">
            ${list.map((a) => {
              const m = statusMeta(a.status);
              return html`<a class="kd-item" href="#/applications/${a.id}">
                <kd-score size="s" .value=${a.matchScore}></kd-score>
                <span class="body">
                  <div class="title">${a.title}</div>
                  <div class="sub">${[a.company, a.location, a.source ? sourceLabel(a.source) : ''].filter(Boolean).join(' · ')}</div>
                </span>
                <span class="row nowrap" style="gap:.375rem">
                  ${this.dueChip(a)}
                  <span class="kd-tag secondary">${ic(m.icon)}${m.label}</span>
                  <span class="kd-hint nowrap">${a.appliedAt ? `envoyée ${relDays(a.appliedAt)}` : `ajoutée ${relDays(a.createdAt)}`}</span>
                </span>
              </a>`;
            })}
          </div>`
        : emptyState('filter_alt_off', 'Aucune candidature', 'Aucun résultat pour ces filtres.')}`;
  }

  protected override render(): unknown {
    const items = this.items;
    return html`<div class="kd-page">
      <header class="kd-page-head">
        <div>
          <div class="t-overline">Suivi</div>
          <h1 class="t-display">Candidatures</h1>
        </div>
        <div class="actions">
          <k3-button-segmented
            aria-label="Affichage"
            .segments=${[
              { label: 'Tableau', icon: 'view_kanban', value: 'board' },
              { label: 'Liste', icon: 'view_list', value: 'list' },
            ]}
            .selectedIndices=${[this.view === 'board' ? 0 : 1]}
            @k3-change=${(e: CustomEvent<{ values: string[] }>) => {
              this.view = (e.detail.values[0] as 'board' | 'list') ?? 'board';
              localStorage.setItem('kd.apps.view', this.view);
              setQuery({ view: this.view === 'list' ? 'list' : null });
            }}
          ></k3-button-segmented>
          <k3-button variant="filled" @click=${() => window.dispatchEvent(new CustomEvent('kd:new-application'))}>${slotIc('icon', 'add')}Nouvelle</k3-button>
        </div>
      </header>
      <div class="kd-filters">
        <k3-search
          placeholder="Rechercher un poste, une entreprise, une note…"
          .value=${this.q}
          @k3-input=${(e: Event) => {
            this.q = evValue(e);
            this.searchDebounced();
          }}
        ></k3-search>
      </div>
      ${items === null
        ? loading()
        : items.length === 0 && !this.q
          ? emptyState(
              'work_history',
              'Ton suivi est vide',
              'Ajoute une candidature à la main, depuis une offre de ta veille, ou en analysant une annonce.',
              html`<div class="row" style="justify-content:center">
                <k3-button variant="filled" @click=${() => window.dispatchEvent(new CustomEvent('kd:new-application'))}>${slotIc('icon', 'add')}Nouvelle candidature</k3-button>
                <k3-button variant="tonal" @click=${() => navigate('/analyze')}>${slotIc('icon', 'neurology')}Analyser une annonce</k3-button>
              </div>`,
            )
          : this.view === 'board'
            ? this.renderBoard(items)
            : this.renderList(items)}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kd-applications': KdApplications;
  }
}
