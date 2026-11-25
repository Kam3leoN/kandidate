import { html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { Settings } from '../../shared/types.js';
import { LightElement } from '../components/base.js';
import { post } from '../lib/api.js';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../lib/push.js';
import { store, StoreController } from '../lib/store.js';
import { applyTheme } from '../lib/theme.js';
import { copyText, evValue, fmtDate, ic, relDays, shape, slotIc, toast, toastError } from '../lib/ui.js';

const SEEDS: Array<[string, string, Parameters<typeof shape>[0]]> = [
  ['#6750A4', 'Violet M3', 'Cookie9Sided'],
  ['#00639B', 'Bleu océan', 'Clover4Leaf'],
  ['#006A6A', 'Sarcelle', 'Sunny'],
  ['#386A20', 'Vert sauge', 'Cookie6Sided'],
  ['#8B5000', 'Ambre', 'SoftBurst'],
  ['#B3261E', 'Corail', 'Flower'],
  ['#984061', 'Framboise', 'Heart'],
  ['#4C5C92', 'Indigo', 'Gem'],
];

@customElement('kd-settings')
export class KdSettings extends LightElement {
  private store = new StoreController(this);
  @state() private pushOn = false;
  @state() private busy = '';
  @state() private emailDraft = store.state.settings.emailTo;

  override connectedCallback(): void {
    super.connectedCallback();
    void store.refreshSystem().catch(() => undefined);
    void currentSubscription().then((s) => (this.pushOn = !!s && store.state.settings.notifyPush));
  }

  private async save(patch: Partial<Settings>, msg?: string): Promise<void> {
    try {
      const s = await store.saveSettings(patch);
      if (patch.seedColor || patch.themeMode) applyTheme(s);
      if (msg) toast(msg, { icon: 'check_circle' });
    } catch (e) {
      toastError(e);
    }
  }

  private async togglePush(on: boolean): Promise<void> {
    const sys = store.state.system;
    this.busy = 'push';
    try {
      if (on) {
        if (!sys?.push.publicKey) throw new Error('Clés VAPID absentes côté serveur (voir README)');
        await enablePush(sys.push.publicKey);
        await this.save({ notifyPush: true }, 'Notifications push activées sur cet appareil');
      } else {
        await disablePush();
        await this.save({ notifyPush: false }, 'Notifications push désactivées');
      }
      this.pushOn = on;
    } catch (e) {
      this.pushOn = false;
      toastError(e);
    } finally {
      this.busy = '';
    }
  }

  private async action(key: string, path: string, ok: (r: any) => string): Promise<void> {
    this.busy = key;
    try {
      const r = await post(path);
      toast(ok(r), { icon: 'check_circle' });
    } catch (e) {
      toastError(e);
    } finally {
      this.busy = '';
    }
  }

  protected override render(): unknown {
    const s = this.store.state.settings;
    const sys = this.store.state.system;
    const origin = location.origin;
    return html`<div class="kd-page">
      <header class="kd-page-head">
        <div>
          <div class="t-overline">Configuration</div>
          <h1 class="t-display">Réglages</h1>
        </div>
        ${this.store.state.authRequired
          ? html`<div class="actions"><k3-button variant="outlined" @click=${async () => {
              await post('/auth/logout');
              location.reload();
            }}>${slotIc('icon', 'logout')}Se déconnecter</k3-button></div>`
          : nothing}
      </header>

      <div class="kd-grid cols-2">
        <section class="kd-surface stack loose">
          <h2 class="kd-section-title t-title-m">${ic('palette')} Material You</h2>
          <div>
            <div class="kd-field-label">Couleur source (schéma dynamique M3 Expressive)</div>
            <div class="kd-swatches" role="group" aria-label="Couleur source">
              ${SEEDS.map(
                ([hex, label, sh]) => html`<button type="button" class="kd-swatch" style="--sw:${hex}" aria-pressed=${s.seedColor.toLowerCase() === hex.toLowerCase()} title=${label} aria-label=${label} @click=${() => this.save({ seedColor: hex })}>${shape(sh)}</button>`,
              )}
              <label class="kd-swatch" style="--sw:${s.seedColor};position:relative" title="Couleur personnalisée">
                ${shape('Burst')}
                <input type="color" .value=${s.seedColor} aria-label="Couleur personnalisée" style="position:absolute;inset:0;opacity:0;cursor:pointer" @change=${(e: Event) => this.save({ seedColor: (e.target as HTMLInputElement).value })} />
              </label>
            </div>
          </div>
          <div>
            <div class="kd-field-label">Thème</div>
            <k3-button-segmented
              aria-label="Thème"
              .segments=${[
                { label: 'Système', icon: 'brightness_auto', value: 'system' },
                { label: 'Clair', icon: 'light_mode', value: 'light' },
                { label: 'Sombre', icon: 'dark_mode', value: 'dark' },
              ]}
              .selectedIndices=${[['system', 'light', 'dark'].indexOf(s.themeMode)]}
              @k3-change=${(e: CustomEvent<{ values: string[] }>) => this.save({ themeMode: (e.detail.values[0] as Settings['themeMode']) ?? 'system' })}
            ></k3-button-segmented>
          </div>
        </section>

        <section class="kd-surface stack loose">
          <h2 class="kd-section-title t-title-m">${ic('tune')} Matching & relances</h2>
          <div>
            <div class="kd-field-label">Seuil « bonne offre » : ${s.matchThreshold} %</div>
            <k3-slider min="30" max="95" step="5" .value=${s.matchThreshold} aria-label="Seuil" @k3-change=${(e: CustomEvent<{ value: number }>) => this.save({ matchThreshold: e.detail.value })}></k3-slider>
            <p class="kd-hint">Utilisé par le tableau de bord et les alertes sans score minimum propre.</p>
          </div>
          <div>
            <div class="kd-field-label">Délais de relance (jours)</div>
            <div class="kd-grid cols-3-fixed" style="gap:.75rem">
              ${[0, 1, 2].map(
                (i) => html`<k3-text-field variant="outlined" type="number" label=${i === 0 ? '1re relance' : i === 1 ? '2e' : '3e et +'} .value=${String(s.followupDelays[i] ?? '')}
                  @k3-change=${(e: Event) => {
                    const d = [...s.followupDelays];
                    d[i] = Math.max(1, Number(evValue(e)) || 7);
                    void this.save({ followupDelays: d.filter(Boolean) });
                  }}></k3-text-field>`,
              )}
            </div>
            <p class="kd-hint">La 1re relance part ${s.followupDelays[0] ?? 7} jours après l’envoi. Après un entretien : rappel de remerciement à J+3.</p>
          </div>
          <div>
            <div class="kd-field-label">Nombre maximum de relances : ${s.maxFollowups}</div>
            <k3-slider min="0" max="6" step="1" stops .value=${s.maxFollowups} aria-label="Relances max" @k3-change=${(e: CustomEvent<{ value: number }>) => this.save({ maxFollowups: e.detail.value })}></k3-slider>
          </div>
        </section>

        <section class="kd-surface stack">
          <h2 class="kd-section-title t-title-m">${ic('notifications_active')} Notifications</h2>
          <k3-list variant="segmented">
            <k3-list-item leading="icon">
              <span slot="leading" class="ms" data-k3-icon="inbox" aria-hidden="true"></span>
              <span slot="headline">Centre de notifications</span>
              <span slot="supporting">Offres qui matchent, relances, entretiens</span>
              <k3-switch slot="trailing" ?selected=${s.notifyInApp} aria-label="Notifications in-app" @k3-change=${(e: CustomEvent<{ selected: boolean }>) => this.save({ notifyInApp: e.detail.selected })}></k3-switch>
            </k3-list-item>
            <k3-list-item leading="icon">
              <span slot="leading" class="ms" data-k3-icon="vibration" aria-hidden="true"></span>
              <span slot="headline">Push sur cet appareil</span>
              <span slot="supporting">${!pushSupported() ? 'Non supporté par ce navigateur' : sys && !sys.push.configured ? 'Serveur : clés VAPID manquantes' : 'Même application fermée (PWA)'}</span>
              <k3-switch slot="trailing" ?selected=${this.pushOn} ?disabled=${!pushSupported() || this.busy === 'push' || (sys ? !sys.push.configured : true)} aria-label="Notifications push" @k3-change=${(e: CustomEvent<{ selected: boolean }>) => this.togglePush(e.detail.selected)}></k3-switch>
            </k3-list-item>
            <k3-list-item leading="icon">
              <span slot="leading" class="ms" data-k3-icon="mail" aria-hidden="true"></span>
              <span slot="headline">Récap quotidien par email</span>
              <span slot="supporting">${sys && !sys.email.configured ? 'Serveur : RESEND_API_KEY manquant' : 'Envoyé après la veille, s’il y a du nouveau'}</span>
              <k3-switch slot="trailing" ?selected=${s.notifyEmail} ?disabled=${sys ? !sys.email.configured : true} aria-label="Email" @k3-change=${(e: CustomEvent<{ selected: boolean }>) => this.save({ notifyEmail: e.detail.selected })}></k3-switch>
            </k3-list-item>
          </k3-list>
          <div class="row nowrap" style="align-items:flex-start">
            <k3-text-field variant="outlined" type="email" label="Adresse du récap" style="flex:1" .value=${this.emailDraft} @k3-input=${(e: Event) => (this.emailDraft = evValue(e))}></k3-text-field>
            <k3-button variant="tonal" size="md" ?disabled=${this.emailDraft === s.emailTo} @click=${() => this.save({ emailTo: this.emailDraft }, 'Adresse enregistrée')}>OK</k3-button>
          </div>
          <div class="row">
            <k3-button variant="text" size="sm" ?disabled=${!this.pushOn || this.busy === 'ptest'} @click=${() => this.action('ptest', '/push/test', (r) => `Push envoyé à ${r.sent} appareil(s)`)}>${slotIc('icon', 'send_to_mobile')}Tester le push</k3-button>
            <k3-button variant="text" size="sm" ?disabled=${!s.emailTo || this.busy === 'etest'} @click=${() => this.action('etest', '/email/test', () => `Email de test envoyé à ${s.emailTo}`)}>${slotIc('icon', 'outgoing_mail')}Tester l’email</k3-button>
            <k3-button variant="text" size="sm" ?disabled=${!s.notifyEmail || this.busy === 'digest'} @click=${() => this.action('digest', '/email/digest', (r) => `${r.sent} alerte(s) envoyée(s) par email`)}>${slotIc('icon', 'forward_to_inbox')}Envoyer le récap</k3-button>
          </div>
        </section>

        <section class="kd-surface stack">
          <h2 class="kd-section-title t-title-m">${ic('radar')} Veille automatique <span class="grow"></span>
            <k3-button variant="tonal" size="sm" ?disabled=${this.busy === 'cron'} @click=${() => this.action('cron', '/watch/run', () => 'Veille exécutée').then(() => store.refreshSystem())}>${slotIc('icon', 'play_arrow')}${this.busy === 'cron' ? 'En cours…' : 'Lancer'}</k3-button>
          </h2>
          <p class="muted">Vercel Cron appelle <code>/api/cron/run</code> chaque matin : alertes, relances dues, entretiens du lendemain, puis récap email.</p>
          ${sys && !sys.cron.secret ? html`<k3-alert variant="warning" label="CRON_SECRET absent">Définis-le en production pour protéger l’endpoint de veille.</k3-alert>` : nothing}
          <div class="kd-list">
            ${(sys?.cron.runs ?? []).map((r) => {
              const st = r.stats as { searches?: Array<{ inserted: number; matches: number }>; followups?: number };
              const ins = (st.searches ?? []).reduce((n, x) => n + x.inserted, 0);
              return html`<div class="kd-item" style="cursor:default">
                ${ic(r.error ? 'error' : r.finished_at ? 'check_circle' : 'hourglass_top')}
                <span class="body"><div class="title">${fmtDate(r.started_at, true)} · ${r.trigger}</div>
                <div class="sub">${r.error ? r.error : `${ins} offre(s) nouvelle(s) · ${st.followups ?? 0} relance(s) rappelée(s)`}</div></span>
                <span class="kd-hint">${relDays(r.started_at)}</span>
              </div>`;
            })}
            ${sys && !sys.cron.runs.length ? html`<p class="kd-hint">Aucune exécution pour l’instant.</p>` : nothing}
          </div>
        </section>
      </div>

      <section class="kd-surface stack" style="margin-top:var(--kd-gap)">
        <h2 class="kd-section-title t-title-m">${ic('hub')} Sources d’offres <span class="grow"></span>
          ${sys ? html`<span class="kd-tag ${sys.db === 'neon' ? 'success' : 'warning'}">${ic('database')}${sys.db === 'neon' ? 'Neon Postgres' : 'PGlite local'}</span>` : nothing}
        </h2>
        <div class="kd-grid cols-2">
          ${(sys?.sources ?? []).map(
            (src) => html`<div class="kd-item" style="cursor:default;align-items:flex-start">
              <span class="kd-shape-icon" style="--kd-shape-bg:var(--k3-sys-color-${src.configured ? 'primary' : 'surface-container-highest'}${src.configured ? '-container' : ''});--kd-shape-fg:var(--k3-sys-color-${src.configured ? 'on-primary-container' : 'outline'});width:2.75rem;height:2.75rem">${shape(src.configured ? 'Cookie9Sided' : 'Circle')}${ic(src.configured ? 'check' : 'key')}</span>
              <span class="body">
                <div class="row between nowrap"><span class="title">${src.label}</span><span class="kd-tag ${src.configured ? 'success' : 'outline'}">${src.configured ? 'Active' : 'À configurer'}</span></div>
                <div class="sub" style="white-space:normal">${src.note}</div>
                ${!src.configured && src.needs.length ? html`<div class="kd-hint" style="margin-top:.25rem">Variables : ${src.needs.map((n) => html`<code>${n}</code> `)}</div>` : nothing}
              </span>
            </div>`,
          )}
        </div>
        <div class="kd-surface high stack tight">
          <div class="t-title-m">${ic('forward_to_inbox')} Alertes LinkedIn / Cadremploi / APEC par email</div>
          <p class="muted">Ces sites n’ont pas d’API publique : crée tes alertes chez eux, puis transfère automatiquement ces emails (règle de transfert Gmail/Outlook) vers ton adresse de réception Resend${sys?.inbound.address ? html` <strong>${sys.inbound.address}</strong>` : ''}. Webhook à déclarer dans Resend (événement <code>email.received</code>) :</p>
          <div class="row nowrap"><code class="kd-code" style="flex:1">${origin}/api/inbound/resend</code>
            <k3-icon-button variant="standard" label="Copier" @click=${() => copyText(`${origin}/api/inbound/resend`)}>${ic('content_copy')}</k3-icon-button></div>
          <p class="kd-hint">Autre fournisseur (Postmark, Cloudflare Email, Make…) : POST JSON <code>{ from, subject, html, text }</code> sur <code>${origin}/api/inbound/email?token=INBOUND_TOKEN</code>. Sans automatisation, colle l’email dans Analyse → Alerte email.</p>
        </div>
      </section>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kd-settings': KdSettings;
  }
}
