import { html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import { LightElement } from './components/base.js';
import { get, onUnauthorized, post } from './lib/api.js';
import { NAV, navigate, parseRoute, type Route } from './lib/router.js';
import { store, StoreController } from './lib/store.js';
import { applyTheme } from './lib/theme.js';
import { evValue, ic, slotIc, toastError } from './lib/ui.js';
import './components/new-application.js';
import type { RouteName } from './lib/router.js';

/** Route-level code splitting: each view is fetched the first time it is shown. */
const VIEWS: Partial<Record<RouteName, () => Promise<unknown>>> = {
  dashboard: () => import('./views/dashboard.js'),
  applications: () => import('./views/applications.js'),
  application: () => import('./views/application-detail.js'),
  offers: () => import('./views/offers.js'),
  offer: () => import('./views/offer-detail.js'),
  analyze: () => import('./views/analyze.js'),
  profile: () => import('./views/profile.js'),
  notifications: () => import('./views/notifications.js'),
  settings: () => import('./views/settings.js'),
};
/** Views whose module is loaded: render them only once defined (properties then reach the real element). */
const readyViews = new Set<RouteName>();

const BAR_MQ = matchMedia('(max-width: 599.98px)');

/** Rail destinations: main NAV + trailing (notifications, settings). */
const RAIL = [...NAV, { route: 'notifications', path: '/notifications', label: 'Alertes', icon: 'notifications' }, { route: 'settings', path: '/settings', label: 'Réglages', icon: 'settings' }] as const;

const logo = html`<svg class="kd-logo" viewBox="0 0 1 1" aria-hidden="true">
  <path d="M0.5 0.02C0.62 0.02 0.64 0.12 0.74 0.16C0.84 0.2 0.94 0.14 0.98 0.26C1.02 0.38 0.92 0.42 0.92 0.5C0.92 0.58 1.02 0.62 0.98 0.74C0.94 0.86 0.84 0.8 0.74 0.84C0.64 0.88 0.62 0.98 0.5 0.98C0.38 0.98 0.36 0.88 0.26 0.84C0.16 0.8 0.06 0.86 0.02 0.74C-0.02 0.62 0.08 0.58 0.08 0.5C0.08 0.42 -0.02 0.38 0.02 0.26C0.06 0.14 0.16 0.2 0.26 0.16C0.36 0.12 0.38 0.02 0.5 0.02Z"></path>
  <text x="0.5" y="0.68" text-anchor="middle">K</text>
</svg>`;

@customElement('kd-app')
export class KdApp extends LightElement {
  private store = new StoreController(this);
  @state() private route: Route = parseRoute();
  @state() private bar = BAR_MQ.matches;
  @state() private needLogin = false;
  @state() private booting = true;
  @state() private password = '';
  @state() private loginError = '';
  private poll?: ReturnType<typeof setInterval>;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('hashchange', this.onHash);
    BAR_MQ.addEventListener('change', this.onMq);
    document.addEventListener('visibilitychange', this.onVisible);
    onUnauthorized(() => (this.needLogin = true));
    this.loadView(this.route.name);
    void this.start();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('hashchange', this.onHash);
    BAR_MQ.removeEventListener('change', this.onMq);
    document.removeEventListener('visibilitychange', this.onVisible);
    clearInterval(this.poll);
  }

  private onHash = (): void => {
    this.route = parseRoute();
    this.loadView(this.route.name);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };
  private onMq = (): void => {
    this.bar = BAR_MQ.matches;
  };
  private onVisible = (): void => {
    if (document.visibilityState === 'visible' && store.state.ready) void store.refreshUnread().catch(() => undefined);
  };

  private async start(): Promise<void> {
    try {
      const me = await get<{ authenticated: boolean; authRequired: boolean }>('/auth/me');
      store.set({ authenticated: me.authenticated, authRequired: me.authRequired });
      if (!me.authenticated) {
        this.needLogin = true;
        return;
      }
      await store.load();
      applyTheme(store.state.settings);
      this.poll = setInterval(() => void store.refreshUnread().catch(() => undefined), 60_000);
    } catch (e) {
      toastError(e, 'API injoignable');
    } finally {
      this.booting = false;
    }
  }

  private async login(e?: Event): Promise<void> {
    e?.preventDefault();
    this.loginError = '';
    try {
      await post('/auth/login', { password: this.password });
      this.needLogin = false;
      this.booting = true;
      await this.start();
    } catch (err) {
      this.loginError = (err as Error).message;
    }
  }

  private loadView(name: RouteName): void {
    if (readyViews.has(name) || !VIEWS[name]) return;
    VIEWS[name]!()
      .then(() => {
        readyViews.add(name);
        this.requestUpdate();
      })
      .catch((e) => toastError(e, 'Chargement de la page impossible'));
  }

  private navIndex(): number {
    const name = this.route.name === 'application' ? 'applications' : this.route.name === 'offer' ? 'offers' : this.route.name;
    return RAIL.findIndex((n) => n.route === name);
  }

  private renderView(): unknown {
    const r = this.route;
    if (VIEWS[r.name] && !readyViews.has(r.name)) return html`<div class="kd-loading" style="min-height:60vh"><k3-loading-indicator></k3-loading-indicator></div>`;
    switch (r.name) {
      case 'dashboard':
        return html`<kd-dashboard></kd-dashboard>`;
      case 'applications':
        return html`<kd-applications .route=${r}></kd-applications>`;
      case 'application':
        return html`<kd-application-detail .appId=${Number(r.params.id)} .route=${r}></kd-application-detail>`;
      case 'offers':
        return html`<kd-offers .route=${r}></kd-offers>`;
      case 'offer':
        return html`<kd-offer-detail .offerId=${Number(r.params.id)}></kd-offer-detail>`;
      case 'analyze':
        return html`<kd-analyze .route=${r}></kd-analyze>`;
      case 'profile':
        return html`<kd-profile></kd-profile>`;
      case 'notifications':
        return html`<kd-notifications></kd-notifications>`;
      case 'settings':
        return html`<kd-settings></kd-settings>`;
      default:
        return html`<div class="kd-page"><div class="kd-empty"><div class="t-headline">Page introuvable</div><k3-button variant="tonal" @click=${() => navigate('/')}>Retour à l’accueil</k3-button></div></div>`;
    }
  }

  private renderLogin(): unknown {
    return html`<div class="kd-login">
      <form class="card kd-pop" @submit=${(e: Event) => this.login(e)}>
        <div class="kd-brand" style="flex-direction:column;font-size:2rem">${logo}<span>Kandi<b>Date</b></span></div>
        <p class="muted">Ton espace de recherche d’emploi est protégé. Saisis ton mot de passe.</p>
        <k3-text-field
          variant="outlined"
          type="password"
          label="Mot de passe"
          password-toggle
          style="width:100%"
          .error=${this.loginError}
          @k3-input=${(e: Event) => (this.password = evValue(e))}
          @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this.login()}
        ></k3-text-field>
        <k3-button variant="filled" size="md" type="submit" style="width:100%" @click=${() => this.login()}>${slotIc('icon', 'login')}Entrer</k3-button>
      </form>
    </div>`;
  }

  protected override render(): unknown {
    if (this.needLogin) return this.renderLogin();
    if (this.booting && !store.state.ready) return html`<div class="kd-loading" style="min-height:100dvh"><k3-loading-indicator contained></k3-loading-indicator></div>`;
    const active = this.navIndex();
    const unread = this.store.state.unread;
    const sys = this.store.state.system;
    return html`<div class="kd-shell" data-nav=${this.bar ? 'bar' : 'rail'}>
      <k3-nav-rail
        class="kd-rail"
        size="compact"
        layout="standard"
        aria-label="Navigation principale"
        .active=${Math.max(0, active)}
        @k3-change=${(e: CustomEvent<{ index: number }>) => navigate(RAIL[e.detail.index]?.path ?? '/')}
      >
        <k3-extended-fab slot="fab" class="rail-fab-extended" size="medium" variant="primary" aria-label="Nouvelle candidature" @click=${() => window.dispatchEvent(new CustomEvent('kd:new-application'))}>
          ${slotIc('icon', 'add')}<span>Candidature</span>
        </k3-extended-fab>
        ${NAV.map((n) => html`<k3-nav-item icon=${n.icon} label=${n.label}></k3-nav-item>`)}
        <k3-nav-item slot="trailing" icon="notifications" label="Alertes" badge=${unread ? String(unread) : ''}></k3-nav-item>
        <k3-nav-item slot="trailing" icon="settings" label="Réglages"></k3-nav-item>
      </k3-nav-rail>

      <div class="kd-main">
        <k3-top-app-bar class="kd-appbar" size="small" sticky>
          <a slot="headline" class="kd-brand" href="#/" aria-label="KandiDate — accueil">${logo}<span>Kandi<b>Date</b></span></a>
          <div slot="trailing" class="kd-appbar-actions">
            ${sys && sys.db === 'pglite'
              ? html`<k3-tooltip variant="plain" position="bottom" content="Base locale PGlite : définis DATABASE_URL (Neon) pour la prod">
                  <span class="kd-tag warning">${ic('database')}Local</span>
                </k3-tooltip>`
              : nothing}
            <k3-icon-button
              variant="standard"
              label=${this.store.state.settings.themeMode === 'dark' ? 'Thème clair' : 'Thème sombre'}
              @click=${() => {
                const dark = document.documentElement.dataset.k3ColorMode === 'dark';
                const themeMode = dark ? 'light' : 'dark';
                applyTheme({ ...store.state.settings, themeMode });
                void store.saveSettings({ themeMode }).catch(toastError);
              }}
              >${ic(document.documentElement.dataset.k3ColorMode === 'dark' ? 'light_mode' : 'dark_mode')}</k3-icon-button
            >
            ${this.bar
              ? html`<k3-icon-button variant="standard" label="Notifications" @click=${() => navigate('/notifications')}>
                    <k3-badge value=${unread ? String(unread) : ''}>${ic('notifications')}</k3-badge>
                  </k3-icon-button>
                  <k3-icon-button variant="standard" label="Réglages" @click=${() => navigate('/settings')}>${ic('settings')}</k3-icon-button>`
              : nothing}
          </div>
        </k3-top-app-bar>
        <main id="main">${keyed(this.route.path, this.renderView())}</main>
      </div>

      <k3-nav-bar class="kd-bar" .active=${active < NAV.length ? active : -1} @k3-change=${(e: CustomEvent<{ index: number }>) => navigate(NAV[e.detail.index]?.path ?? '/')}>
        ${NAV.map((n) => html`<k3-nav-item icon=${n.icon} label=${n.label}></k3-nav-item>`)}
      </k3-nav-bar>

      <kd-new-application></kd-new-application>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kd-app': KdApp;
  }
}
