import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AdAnalysis, MatchResult } from '../../shared/analysis/index.js';
import type { Offer } from '../../shared/types.js';
import '../components/analysis-view.js';
import { LightElement } from '../components/base.js';
import { loading } from '../components/offer-card.js';
import { get, patch, post } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { fmtDate, ic, remoteLabel, salaryLabel, slotIc, sourceLabel, toast, toastError } from '../lib/ui.js';

@customElement('kd-offer-detail')
export class KdOfferDetail extends LightElement {
  @property({ type: Number }) offerId = 0;
  @state() private offer: (Offer & { analysis: AdAnalysis; match: MatchResult }) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.offer = await get(`/offers/${this.offerId}`);
    } catch (e) {
      toastError(e);
    }
  }

  private async setStatus(status: Offer['status'], msg: string, icon: string): Promise<void> {
    try {
      await patch(`/offers/${this.offerId}`, { status });
      toast(msg, { icon });
      await this.load();
    } catch (e) {
      toastError(e);
    }
  }

  private async apply(status: 'wishlist' | 'applied'): Promise<void> {
    try {
      const app = await post<{ id: number }>(`/offers/${this.offerId}/apply`, { status });
      window.dispatchEvent(new CustomEvent('kd:applications-changed'));
      toast(status === 'applied' ? 'Candidature envoyée — relance programmée' : 'Ajoutée à « À postuler »', { icon: 'add_task' });
      navigate(`/applications/${app.id}`);
    } catch (e) {
      toastError(e);
    }
  }

  protected override render(): unknown {
    const o = this.offer;
    if (!o) return html`<div class="kd-page">${loading()}</div>`;
    const salary = salaryLabel(o.salaryMin, o.salaryMax, o.salaryText);
    return html`<div class="kd-page">
      <header class="kd-page-head" style="align-items:flex-start">
        <div class="row nowrap" style="align-items:flex-start;gap:1rem;min-width:0">
          <k3-icon-button variant="tonal" label="Retour" @click=${() => (history.length > 1 ? history.back() : navigate('/offers'))}>${ic('arrow_back')}</k3-icon-button>
          <div style="min-width:0">
            <div class="t-overline">${sourceLabel(o.source)}${o.publishedAt ? ` · publiée le ${fmtDate(o.publishedAt)}` : ''}</div>
            <h1 class="t-headline">${o.title}</h1>
            <div class="muted" style="margin-top:.25rem">${[o.company, o.location].filter(Boolean).join(' · ')}</div>
            <div class="row" style="margin-top:.625rem">
              ${o.contract ? html`<span class="kd-tag">${o.contract}</span>` : nothing}
              ${o.remote ? html`<span class="kd-tag secondary">${ic('home_work')}${remoteLabel(o.remote)}</span>` : nothing}
              ${salary ? html`<span class="kd-tag">${ic('payments')}${salary}</span>` : nothing}
              ${o.status === 'saved' ? html`<span class="kd-tag tertiary">${ic('bookmark')}Sauvegardée</span>` : nothing}
              ${o.status === 'dismissed' ? html`<span class="kd-tag outline">${ic('visibility_off')}Ignorée</span>` : nothing}
            </div>
          </div>
        </div>
        <div class="actions">
          ${o.applicationId
            ? html`<k3-button variant="filled" @click=${() => navigate(`/applications/${o.applicationId}`)}>${slotIc('icon', 'work_history')}Voir le suivi</k3-button>`
            : html`<k3-button variant="filled" @click=${() => this.apply('applied')}>${slotIc('icon', 'send')}J’ai postulé</k3-button>
                <k3-button variant="tonal" @click=${() => this.apply('wishlist')}>${slotIc('icon', 'add_task')}À postuler</k3-button>`}
          ${o.status !== 'saved' && !o.applicationId
            ? html`<k3-icon-button variant="standard" label="Sauvegarder" @click=${() => this.setStatus('saved', 'Offre sauvegardée', 'bookmark_added')}>${ic('bookmark_add')}</k3-icon-button>`
            : nothing}
          ${o.status !== 'dismissed' && !o.applicationId
            ? html`<k3-icon-button variant="standard" label="Ignorer" @click=${() => this.setStatus('dismissed', 'Offre ignorée', 'visibility_off')}>${ic('visibility_off')}</k3-icon-button>`
            : nothing}
          ${o.url ? html`<k3-icon-button variant="tonal" label="Annonce d’origine" @click=${() => window.open(o.url, '_blank', 'noopener')}>${ic('open_in_new')}</k3-icon-button>` : nothing}
        </div>
      </header>
      <kd-analysis .analysis=${o.analysis} .match=${o.match}></kd-analysis>
      <section class="kd-surface" style="margin-top:var(--kd-gap)">
        <h2 class="kd-section-title t-title-m">${ic('description')} Annonce</h2>
        ${o.source === 'email' || o.description.length < 400
          ? html`<k3-alert variant="info" label="Description partielle" style="margin-bottom:1rem">
              Cette source ne fournit qu’un extrait. Ouvre l’annonce d’origine, puis colle son texte dans l’onglet « Infos » de la candidature (ou dans Analyse) pour un score complet.
            </k3-alert>`
          : nothing}
        <div class="kd-desc">${o.description || 'Description non fournie par la source.'}</div>
        ${o.source === 'remotive' ? html`<p class="kd-hint" style="margin-top:.75rem">Offre fournie par <a href=${o.url} target="_blank" rel="noopener">Remotive</a>.</p>` : nothing}
      </section>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kd-offer-detail': KdOfferDetail;
  }
}
