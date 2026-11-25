import { html, nothing, type PropertyValues } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import type { Application, Offer } from '../../shared/types.js';
import { LightElement } from '../components/base.js';
import { emptyState, loading, offerCard } from '../components/offer-card.js';
import { get, post } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { store, StoreController } from '../lib/store.js';
import { daysUntil, fmtDate, ic, relDays, shape, slotIc, toast, toastError } from '../lib/ui.js';

interface Stats {
  byStatus: Record<string, number>;
  sent: number;
  responseRate: number | null;
  interviewRate: number | null;
  avgScore: number | null;
  offersNew: number;
  offersWeek: number;
  weeks: string[];
  weeklyApplications: number[];
  weeklyMatches: number[];
  followupsDue: Application[];
  interviews: Array<{ id: number; applicationId: number; at: string; title: string; appTitle: string; company: string }>;
  topOffers: Offer[];
  sources: Array<{ source: string; n: number }>;
  lastRun: { started_at: string; trigger: string; error: string | null } | null;
  threshold: number;
}

type ChartEl = HTMLElement & { data: unknown; options: unknown };

@customElement('kd-dashboard')
export class KdDashboard extends LightElement {
  private store = new StoreController(this);
  @state() private stats: Stats | null = null;
  @state() private running = false;
  @query('#kd-activity') private chart?: ChartEl;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
    window.addEventListener('kd:applications-changed', this.reload);
    // k3ux chart (Chart.js) — loaded only on the dashboard.
    void import('@k3ux/components/charts/chart.js');
  }
  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('kd:applications-changed', this.reload);
  }
  private reload = (): void => void this.load();

  private async load(): Promise<void> {
    try {
      this.stats = await get<Stats>('/stats');
    } catch (e) {
      toastError(e);
    }
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has('stats') && this.stats) void this.paintChart();
  }

  private async paintChart(): Promise<void> {
    await customElements.whenDefined('k3-chart');
    const s = this.stats;
    if (!this.chart || !s) return;
    const css = getComputedStyle(document.documentElement);
    const primary = css.getPropertyValue('--k3-sys-color-primary').trim();
    const tertiary = css.getPropertyValue('--k3-sys-color-tertiary').trim();
    this.chart.data = {
      labels: s.weeks.map((w) => new Date(w).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })),
      datasets: [
        { type: 'bar', label: 'Candidatures envoyées', data: s.weeklyApplications, backgroundColor: primary, borderRadius: 10, maxBarThickness: 22 },
        { type: 'line', label: `Offres ≥ ${s.threshold} %`, data: s.weeklyMatches, borderColor: tertiary, backgroundColor: tertiary, tension: 0.4, pointRadius: 3, yAxisID: 'y' },
      ],
    };
    this.chart.options = { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } };
  }

  private async runWatch(): Promise<void> {
    this.running = true;
    try {
      const r = await post<{ searches?: Array<{ inserted: number; matches: number }>; followups: number; interviews: number }>('/watch/run');
      const ins = (r.searches ?? []).reduce((s, x) => s + x.inserted, 0);
      const m = (r.searches ?? []).reduce((s, x) => s + x.matches, 0);
      toast(`Veille terminée : ${ins} nouvelle(s) offre(s), ${m} au-dessus de ton seuil`, { icon: 'radar' });
      await Promise.all([this.load(), store.refreshUnread()]);
    } catch (e) {
      toastError(e);
    } finally {
      this.running = false;
    }
  }

  private async followupDone(a: Application): Promise<void> {
    try {
      await post(`/applications/${a.id}/followup`, { channel: 'email' });
      toast(`Relance notée pour ${a.company || a.title}`, { icon: 'forward_to_inbox' });
      await this.load();
    } catch (e) {
      toastError(e);
    }
  }

  private async snooze(a: Application): Promise<void> {
    try {
      await post(`/applications/${a.id}/snooze`, { days: 3 });
      toast('Relance reportée de 3 jours', { icon: 'snooze' });
      await this.load();
    } catch (e) {
      toastError(e);
    }
  }

  private kpi(shapeName: Parameters<typeof shape>[0], icon: string, value: unknown, label: string, href: string, tone: string): unknown {
    return html`<a class="kd-kpi" href=${href}>
      <span class="kd-shape-icon" style="--kd-shape-bg:var(--k3-sys-color-${tone}-container);--kd-shape-fg:var(--k3-sys-color-on-${tone}-container)">${shape(shapeName)}${ic(icon)}</span>
      <span><div class="value">${value}</div><div class="label">${label}</div></span>
    </a>`;
  }

  protected override render(): unknown {
    const s = this.stats;
    const p = this.store.state.profile;
    const first = p.fullName.split(' ')[0];
    const hour = new Date().getHours();
    const hello = hour < 5 ? 'Bonne nuit' : hour < 18 ? 'Bonjour' : 'Bonsoir';
    if (!s) return html`<div class="kd-page">${loading()}</div>`;
    const active = ['wishlist', 'applied', 'followup', 'interview', 'offer'].reduce((n, k) => n + (s.byStatus[k] ?? 0), 0);
    const due = s.followupsDue.filter((a) => (daysUntil(a.nextFollowupAt) ?? 1) <= 0);
    const profileEmpty = !p.skills.length || !p.targetTitles.length;
    return html`<div class="kd-page">
      <section class="kd-hero kd-pop" style="margin-block:.75rem 1.25rem">
        <span class="deco a">${shape('Cookie12Sided')}</span>
        <span class="deco b">${shape('Clover4Leaf')}</span>
        <div class="t-overline" style="color:inherit;opacity:.8">${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1 class="t-display">${hello}${first ? ` ${first}` : ''}</h1>
        <p>
          ${due.length ? html`<strong>${due.length} relance${due.length > 1 ? 's' : ''} à faire</strong> aujourd’hui · ` : nothing}
          ${s.interviews.length ? html`<strong>${s.interviews.length} entretien${s.interviews.length > 1 ? 's' : ''}</strong> à venir · ` : nothing}
          ${s.offersNew} nouvelle${s.offersNew > 1 ? 's' : ''} offre${s.offersNew > 1 ? 's' : ''} dans ta boîte de réception.
        </p>
        <div class="actions">
          <k3-button variant="filled" size="md" @click=${() => navigate('/offers')}>${slotIc('icon', 'travel_explore')}Voir les offres</k3-button>
          <k3-button variant="tonal" size="md" ?disabled=${this.running} @click=${() => this.runWatch()}>${slotIc('icon', 'radar')}${this.running ? 'Veille en cours…' : 'Lancer la veille'}</k3-button>
          <k3-button variant="text" size="md" @click=${() => navigate('/analyze')}>${slotIc('icon', 'neurology')}Analyser une annonce</k3-button>
        </div>
      </section>

      ${profileEmpty
        ? html`<k3-alert variant="tertiary" label="Complète ton profil" style="margin-bottom:1.25rem">
            Ajoute tes postes cibles et tes compétences : le score de match de chaque offre en dépend.
            <k3-button slot="action" variant="text" size="sm" @click=${() => navigate('/profile')}>Compléter</k3-button>
          </k3-alert>`
        : nothing}

      <div class="kd-grid kpis kd-stagger" style="margin-bottom:var(--kd-gap)">
        ${this.kpi('Cookie9Sided', 'work_history', active, 'candidatures actives', '#/applications', 'primary')}
        ${this.kpi('Clover4Leaf', 'mark_email_read', s.responseRate == null ? '–' : html`${s.responseRate}<small> %</small>`, `taux de réponse · ${s.sent} envoyée${s.sent > 1 ? 's' : ''}`, '#/applications?view=list', 'secondary')}
        ${this.kpi('Sunny', 'groups', s.interviewRate == null ? '–' : html`${s.interviewRate}<small> %</small>`, 'décrochent un entretien', '#/applications?status=interview', 'tertiary')}
        ${this.kpi('SoftBurst', 'local_fire_department', s.offersWeek, `offres ≥ ${s.threshold} % cette semaine`, '#/offers', 'primary')}
      </div>

      <div class="kd-split">
        <div class="stack loose">
          <section class="kd-surface">
            <h2 class="kd-section-title t-title-m">${ic('event_upcoming')} À faire <span class="grow"></span>
              <k3-button variant="text" size="sm" @click=${() => navigate('/applications')}>Tout le suivi</k3-button>
            </h2>
            ${s.followupsDue.length || s.interviews.length
              ? html`<div class="kd-list">
                  ${s.interviews.map(
                    (i) => html`<a class="kd-item" href="#/applications/${i.applicationId}">
                      <span class="kd-shape-icon" style="--kd-shape-bg:var(--k3-sys-color-tertiary-container);--kd-shape-fg:var(--k3-sys-color-on-tertiary-container);width:2.75rem;height:2.75rem">${shape('Gem')}${ic('groups')}</span>
                      <span class="body"><div class="title">${i.title || 'Entretien'} · ${i.appTitle}</div><div class="sub">${i.company} — ${fmtDate(i.at, true)} (${relDays(i.at)})</div></span>
                    </a>`,
                  )}
                  ${s.followupsDue.map((a) => {
                    const d = daysUntil(a.nextFollowupAt) ?? 0;
                    return html`<div class="kd-item" @click=${(e: Event) => {
                      if ((e.target as HTMLElement).closest('k3-icon-button')) return;
                      navigate(`/applications/${a.id}`);
                    }}>
                      <span class="kd-shape-icon" style="--kd-shape-bg:var(--k3-sys-color-${d < 0 ? 'error' : 'primary'}-container);--kd-shape-fg:var(--k3-sys-color-on-${d < 0 ? 'error' : 'primary'}-container);width:2.75rem;height:2.75rem">${shape('Cookie6Sided')}${ic('forward_to_inbox')}</span>
                      <span class="body">
                        <div class="title">Relancer ${a.company || a.title}</div>
                        <div class="sub">${a.title} · ${d < 0 ? `en retard de ${-d} j` : d === 0 ? 'aujourd’hui' : relDays(a.nextFollowupAt)} · relance n°${a.followupCount + 1}</div>
                      </span>
                      <k3-icon-button variant="tonal" label="J’ai relancé" @click=${() => this.followupDone(a)}>${ic('done')}</k3-icon-button>
                      <k3-icon-button variant="standard" label="Reporter de 3 jours" @click=${() => this.snooze(a)}>${ic('snooze')}</k3-icon-button>
                    </div>`;
                  })}
                </div>`
              : emptyState('task_alt', 'Rien d’urgent', 'Aucune relance ni entretien dans les 7 prochains jours.')}
          </section>

          <section class="kd-surface">
            <h2 class="kd-section-title t-title-m">${ic('insights')} Activité sur 12 semaines</h2>
            <k3-chart id="kd-activity" class="kd-chart" type="bar" height="240"></k3-chart>
          </section>
        </div>

        <div class="stack loose">
          <section class="kd-surface">
            <h2 class="kd-section-title t-title-m">${ic('local_fire_department')} Meilleures offres <span class="grow"></span>
              <k3-button variant="text" size="sm" @click=${() => navigate('/offers')}>Boîte de réception</k3-button>
            </h2>
            ${s.topOffers.length
              ? html`<div class="stack tight">${s.topOffers.map((o) => offerCard(o, {}))}</div>`
              : emptyState('radar', 'Pas encore d’offres', 'Crée une alerte dans « Offres » : la veille quotidienne remplira ta boîte de réception.', html`<k3-button variant="tonal" @click=${() => navigate('/offers?tab=alerts')}>Créer une alerte</k3-button>`)}
          </section>

          <section class="kd-surface">
            <h2 class="kd-section-title t-title-m">${ic('view_kanban')} Pipeline</h2>
            <div class="stack tight">
              ${[
                ['wishlist', 'À postuler', 'bookmark'],
                ['applied', 'Envoyées', 'send'],
                ['followup', 'Relancées', 'forward_to_inbox'],
                ['interview', 'Entretiens', 'groups'],
                ['offer', 'Propositions', 'handshake'],
              ].map(([k, label, icon]) => {
                const n = s.byStatus[k] ?? 0;
                const max = Math.max(1, ...Object.values(s.byStatus));
                return html`<a class="kd-item" href="#/applications?status=${k}" style="padding:.5rem .75rem">
                  ${ic(icon)}<span class="body"><div class="row between"><span>${label}</span><strong>${n}</strong></div>
                  <div class="kd-meter" style="height:.5rem"><span style="width:${(n / max) * 100}%"></span></div></span>
                </a>`;
              })}
            </div>
            ${s.lastRun
              ? html`<p class="kd-hint" style="margin-top:1rem">${ic('radar')} Dernière veille ${relDays(s.lastRun.started_at)} (${s.lastRun.trigger})${s.lastRun.error ? html` — <span style="color:var(--k3-sys-color-error)">${s.lastRun.error}</span>` : nothing}</p>`
              : html`<p class="kd-hint" style="margin-top:1rem">La veille n’a pas encore tourné.</p>`}
          </section>
        </div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kd-dashboard': KdDashboard;
  }
}
