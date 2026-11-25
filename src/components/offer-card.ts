import { html, nothing, type TemplateResult } from 'lit';
import type { NormalizedOffer, Offer } from '../../shared/types.js';
import { ic, relDays, remoteLabel, salaryLabel, shape, slotIc, sourceLabel } from '../lib/ui.js';
import './score.js';

export type AnyOffer = (Offer | NormalizedOffer) & { matchScore?: number | null };

export interface OfferCardHandlers {
  open?: (o: AnyOffer) => void;
  save?: (o: AnyOffer) => void;
  dismiss?: (o: AnyOffer) => void;
  apply?: (o: AnyOffer) => void;
}

const isStored = (o: AnyOffer): o is Offer & { matchScore: number | null } => typeof (o as Offer).id === 'number';

export function offerCard(o: AnyOffer, h: OfferCardHandlers): TemplateResult {
  const stored = isStored(o);
  const status = stored ? o.status : (o as NormalizedOffer).storedStatus ?? null;
  const applied = stored ? !!o.applicationId || status === 'applied' : status === 'applied';
  const salary = salaryLabel(o.salaryMin ?? null, o.salaryMax ?? null, o.salaryText);
  const href = stored ? `#/offers/${o.id}` : (o as NormalizedOffer).storedId ? `#/offers/${(o as NormalizedOffer).storedId}` : null;
  return html`<article class="kd-offer ${status === 'dismissed' ? 'dismissed' : ''}">
    <kd-score .value=${o.matchScore ?? null}></kd-score>
    <div style="min-width:0">
      ${href
        ? html`<a class="title" href=${href}>${o.title}</a>`
        : html`<a class="title" href="javascript:void 0" @click=${(e: Event) => {
            e.preventDefault();
            h.open?.(o);
          }}>${o.title}</a>`}
      <div class="meta">${[o.company, o.location].filter(Boolean).join(' · ')}</div>
      ${o.description ? html`<p class="desc">${o.description}</p>` : nothing}
      <div class="chips">
        <span class="kd-tag outline">${ic('hub')}${sourceLabel(o.source)}</span>
        ${o.contract ? html`<span class="kd-tag">${o.contract}</span>` : nothing}
        ${o.remote && o.remote !== 'onsite' ? html`<span class="kd-tag secondary">${ic('home_work')}${remoteLabel(o.remote)}</span>` : nothing}
        ${salary ? html`<span class="kd-tag">${ic('payments')}${salary}</span>` : nothing}
        ${o.publishedAt ? html`<span class="kd-tag outline">${ic('schedule')}${relDays(o.publishedAt)}</span>` : nothing}
        ${status === 'new' ? html`<span class="kd-tag primary">Nouveau</span>` : nothing}
        ${status === 'saved' ? html`<span class="kd-tag tertiary">${ic('bookmark')}Sauvegardée</span>` : nothing}
        ${applied ? html`<span class="kd-tag success">${ic('send')}Dans le suivi</span>` : nothing}
      </div>
    </div>
    <div class="side">
      ${h.apply && !applied
        ? html`<k3-button variant="tonal" size="sm" @click=${() => h.apply?.(o)}>${slotIc('icon', 'add_task')}Suivre</k3-button>`
        : nothing}
      <div class="row nowrap" style="gap:0">
        ${h.save && status !== 'saved' && !applied
          ? html`<k3-icon-button variant="standard" label="Sauvegarder" @click=${() => h.save?.(o)}>${ic('bookmark_add')}</k3-icon-button>`
          : nothing}
        ${o.url
          ? html`<k3-icon-button variant="standard" label="Ouvrir l’annonce d’origine" @click=${() => window.open(o.url, '_blank', 'noopener')}>${ic('open_in_new')}</k3-icon-button>`
          : nothing}
        ${h.dismiss && status !== 'dismissed' && !applied
          ? html`<k3-icon-button variant="standard" label="Ignorer" @click=${() => h.dismiss?.(o)}>${ic('visibility_off')}</k3-icon-button>`
          : nothing}
      </div>
    </div>
  </article>`;
}

export function emptyState(icon: string, title: string, text: string, action?: TemplateResult): TemplateResult {
  return html`<div class="kd-empty">
    <div class="art">
      ${shape('Cookie9Sided')}
      ${ic(icon)}
    </div>
    <div class="t-title">${title}</div>
    <p style="max-width:32rem">${text}</p>
    ${action ?? nothing}
  </div>`;
}

export const loading = (): TemplateResult => html`<div class="kd-loading"><k3-loading-indicator contained></k3-loading-indicator></div>`;
