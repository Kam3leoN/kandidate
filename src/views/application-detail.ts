import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { analyzeAd, matchProfile } from '../../shared/analysis/index.js';
import { APP_STATUSES, CONTRACT_TYPES, type AppEvent, type AppStatus, type Application } from '../../shared/types.js';
import '../components/analysis-view.js';
import { LightElement } from '../components/base.js';
import { emptyState, loading } from '../components/offer-card.js';
import '../components/score.js';
import { del, get, patch, post } from '../lib/api.js';
import { navigate, setQuery, type Route } from '../lib/router.js';
import { StoreController } from '../lib/store.js';
import { followupTemplate, mailtoHref } from '../lib/templates.js';
import { closeDialog, copyText, daysUntil, evValue, fmtDate, ic, openDialog, relDays, slotIc, sourceLabel, statusMeta, toast, toastError } from '../lib/ui.js';

const EVENT_ICONS: Record<string, string> = {
  created: 'flag',
  status: 'swap_horiz',
  note: 'sticky_note_2',
  followup: 'forward_to_inbox',
  interview: 'groups',
  email: 'mail',
  call: 'call',
  reminder: 'alarm',
};

const TABS = ['suivi', 'analyse', 'infos'] as const;

@customElement('kd-application-detail')
export class KdApplicationDetail extends LightElement {
  private store = new StoreController(this);
  @property({ type: Number }) appId = 0;
  @property({ attribute: false }) route!: Route;
  @state() private app: Application | null = null;
  @state() private events: AppEvent[] = [];
  @state() private tab: (typeof TABS)[number] = 'suivi';
  @state() private edit: Partial<Application> = {};
  @state() private noteDraft = { type: 'note', title: '', body: '' };
  @state() private interviewDraft = { at: '', title: 'Entretien', location: '', body: '' };
  @state() private followDraft = { channel: 'email', body: '' };

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('route')) {
      const t = this.route?.query.get('tab');
      if (t && (TABS as readonly string[]).includes(t)) this.tab = t as (typeof TABS)[number];
    }
  }

  private async load(): Promise<void> {
    try {
      const r = await get<{ application: Application; events: AppEvent[] }>(`/applications/${this.appId}`);
      this.app = r.application;
      this.events = r.events;
      this.edit = { ...r.application };
    } catch (e) {
      toastError(e);
      this.app = null;
    }
  }

  private async patchApp(p: Partial<Application>, msg?: string): Promise<void> {
    try {
      this.app = await patch<Application>(`/applications/${this.appId}`, p);
      this.edit = { ...this.app };
      if (msg) toast(msg, { icon: 'check_circle' });
      const r = await get<{ events: AppEvent[] }>(`/applications/${this.appId}`);
      this.events = r.events;
      window.dispatchEvent(new CustomEvent('kd:applications-changed'));
    } catch (e) {
      toastError(e);
    }
  }

  private async logFollowup(): Promise<void> {
    try {
      this.app = await post<Application>(`/applications/${this.appId}/followup`, this.followDraft);
      await closeDialog(this, 'dlg-follow');
      toast(this.app.nextFollowupAt ? `Relance notée · prochaine ${relDays(this.app.nextFollowupAt)}` : 'Relance notée · plus de relance automatique', { icon: 'forward_to_inbox' });
      await this.load();
    } catch (e) {
      toastError(e);
    }
  }

  private async addInterview(): Promise<void> {
    if (!this.interviewDraft.at) return toast('Choisis la date et l’heure', { icon: 'error' });
    try {
      await post(`/applications/${this.appId}/events`, { type: 'interview', ...this.interviewDraft, at: new Date(this.interviewDraft.at).toISOString() });
      await closeDialog(this, 'dlg-interview');
      toast('Entretien planifié — rappel la veille', { icon: 'event_available' });
      await this.load();
    } catch (e) {
      toastError(e);
    }
  }

  private async addNote(): Promise<void> {
    if (!this.noteDraft.title && !this.noteDraft.body) return;
    try {
      await post(`/applications/${this.appId}/events`, this.noteDraft);
      await closeDialog(this, 'dlg-note');
      this.noteDraft = { type: 'note', title: '', body: '' };
      await this.load();
    } catch (e) {
      toastError(e);
    }
  }

  private async removeApp(): Promise<void> {
    try {
      await del(`/applications/${this.appId}`);
      await closeDialog(this, 'dlg-delete');
      toast('Candidature supprimée', { icon: 'delete' });
      window.dispatchEvent(new CustomEvent('kd:applications-changed'));
      navigate('/applications');
    } catch (e) {
      toastError(e);
    }
  }

  private renderFollowupCard(a: Application): unknown {
    const d = daysUntil(a.nextFollowupAt);
    const p = this.store.state.profile;
    const tpl = followupTemplate(a, p);
    const closed = !APP_STATUSES.find((s) => s.id === a.status)?.open;
    return html`<section class="kd-surface ${d != null && d <= 0 ? 'primary' : ''}">
      <h2 class="kd-section-title t-title-m">${ic('forward_to_inbox')} Relances <span class="grow"></span><span class="kd-tag outline">${a.followupCount} effectuée${a.followupCount > 1 ? 's' : ''}</span></h2>
      ${closed
        ? html`<p class="muted">Candidature clôturée : plus de relance.</p>`
        : a.status === 'wishlist'
          ? html`<p class="muted">Passe la candidature en « Envoyée » pour programmer automatiquement les relances.</p>
              <k3-button variant="filled" style="margin-top:.75rem" @click=${() => this.patchApp({ status: 'applied' }, 'Candidature envoyée — relance programmée')}>${slotIc('icon', 'send')}J’ai postulé</k3-button>`
          : html`<p class="t-body">
                ${a.nextFollowupAt
                  ? html`Prochaine relance <strong>${d! < 0 ? `en retard de ${-d!} jour${-d! > 1 ? 's' : ''}` : d === 0 ? 'aujourd’hui' : `le ${fmtDate(a.nextFollowupAt)} (${relDays(a.nextFollowupAt)})`}</strong>`
                  : html`Aucune relance programmée.`}
              </p>
              <div class="row" style="margin-top:.875rem">
                <k3-button variant="filled" @click=${() => {
                  this.followDraft = { channel: a.contactEmail ? 'email' : 'linkedin', body: '' };
                  void openDialog(this, 'dlg-follow');
                }}>${slotIc('icon', 'done')}J’ai relancé</k3-button>
                <k3-button variant="tonal" @click=${() => copyText(`${tpl.subject}\n\n${tpl.body}`, 'Modèle de relance copié')}>${slotIc('icon', 'content_copy')}Copier le modèle</k3-button>
                ${a.contactEmail ? html`<k3-button variant="text" @click=${() => (location.href = mailtoHref(a.contactEmail, tpl.subject, tpl.body))}>${slotIc('icon', 'mail')}Écrire</k3-button>` : nothing}
                ${a.nextFollowupAt
                  ? html`<k3-button variant="text" @click=${async () => {
                      await post(`/applications/${a.id}/snooze`, { days: 3 });
                      await this.load();
                      toast('Relance reportée de 3 jours', { icon: 'snooze' });
                    }}>${slotIc('icon', 'snooze')}+3 jours</k3-button>`
                  : nothing}
              </div>
              <details style="margin-top:1rem">
                <summary class="t-label" style="cursor:pointer">Modèle « ${tpl.kind} »</summary>
                <pre class="kd-template" style="margin-top:.5rem"><strong>${tpl.subject}</strong>\n\n${tpl.body}</pre>
              </details>`}
    </section>`;
  }

  private renderTimeline(): unknown {
    return html`<section class="kd-surface">
      <h2 class="kd-section-title t-title-m">${ic('timeline')} Historique <span class="grow"></span>
        <k3-button variant="text" size="sm" @click=${() => openDialog(this, 'dlg-note')}>${slotIc('icon', 'add_comment')}Note</k3-button>
        <k3-button variant="text" size="sm" @click=${() => openDialog(this, 'dlg-interview')}>${slotIc('icon', 'event')}Entretien</k3-button>
      </h2>
      <div class="kd-timeline">
        ${this.events.map(
          (e) => html`<div class="kd-tl-item" data-type=${e.type}>
            <span class="dot">${ic(EVENT_ICONS[e.type] ?? 'circle')}</span>
            <div>
              <div class="t-label">${e.title}</div>
              ${e.body ? html`<div class="body">${e.body}</div>` : nothing}
              ${e.type === 'interview' && e.meta?.location ? html`<div class="body">${ic('location_on')} ${String(e.meta.location)}</div>` : nothing}
            </div>
            <div class="when" title=${new Date(e.at).toLocaleString('fr-FR')}>${e.type === 'interview' ? fmtDate(e.at, true) : relDays(e.at)}</div>
          </div>`,
        )}
      </div>
    </section>`;
  }

  private renderAnalysis(a: Application): unknown {
    if (!a.description || a.description.length < 60) {
      return emptyState('neurology', 'Pas de texte d’annonce', 'Colle le texte de l’annonce dans l’onglet « Infos » pour obtenir l’analyse et le score de match.');
    }
    const p = this.store.state.profile;
    const analysis = analyzeAd({ text: a.description, title: a.title, company: a.company, location: a.location, contract: a.contract, salaryText: a.salaryText, extraSkills: p.skills });
    const match = matchProfile(analysis, p, { text: a.description });
    return html`<kd-analysis .analysis=${analysis} .match=${match} no-header></kd-analysis>
      <section class="kd-surface" style="margin-top:var(--kd-gap)">
        <h2 class="t-title-m">${ic('description')} Annonce</h2>
        <div class="kd-desc">${a.description}</div>
      </section>`;
  }

  private field(label: string, key: keyof Application, type = 'text'): unknown {
    return html`<k3-text-field variant="outlined" label=${label} type=${type} .value=${String(this.edit[key] ?? '')} @k3-input=${(e: Event) => (this.edit = { ...this.edit, [key]: evValue(e) })}></k3-text-field>`;
  }

  private renderInfos(): unknown {
    return html`<section class="kd-surface">
      <div class="kd-form">
        <div class="two">${this.field('Intitulé', 'title')}${this.field('Entreprise', 'company')}</div>
        <div class="two">
          ${this.field('Lieu', 'location')}
          <k3-select variant="outlined" label="Contrat" .value=${this.edit.contract ?? ''} @k3-change=${(e: Event) => (this.edit = { ...this.edit, contract: evValue(e) as Application['contract'] })}>
            ${CONTRACT_TYPES.map((c) => html`<k3-menu-item value=${c}>${c}</k3-menu-item>`)}
          </k3-select>
        </div>
        <div class="two">${this.field('Lien de l’annonce', 'url', 'url')}${this.field('Salaire', 'salaryText')}</div>
        <div class="t-overline">Contact</div>
        <div class="two">${this.field('Nom', 'contactName')}${this.field('Rôle', 'contactRole')}</div>
        <div class="two">${this.field('Email', 'contactEmail', 'email')}${this.field('Téléphone', 'contactPhone', 'tel')}</div>
        <k3-textarea variant="outlined" label="Notes" rows="4" .value=${this.edit.notes ?? ''} @k3-input=${(e: Event) => (this.edit = { ...this.edit, notes: evValue(e) })}></k3-textarea>
        <k3-textarea variant="outlined" label="Lettre de motivation / message envoyé" rows="5" .value=${this.edit.coverLetter ?? ''} @k3-input=${(e: Event) => (this.edit = { ...this.edit, coverLetter: evValue(e) })}></k3-textarea>
        <k3-textarea variant="outlined" label="Texte de l’annonce" rows="8" .value=${this.edit.description ?? ''} @k3-input=${(e: Event) => (this.edit = { ...this.edit, description: evValue(e) })}></k3-textarea>
        <div class="row" style="justify-content:flex-end">
          <k3-button variant="text" @click=${() => (this.edit = { ...this.app! })}>Annuler</k3-button>
          <k3-button variant="filled" @click=${() => {
            const p = this.edit;
            void this.patchApp(
              { title: p.title, company: p.company, location: p.location, contract: p.contract, url: p.url, salaryText: p.salaryText, contactName: p.contactName, contactRole: p.contactRole, contactEmail: p.contactEmail, contactPhone: p.contactPhone, notes: p.notes, coverLetter: p.coverLetter, description: p.description },
              'Modifications enregistrées',
            );
          }}>${slotIc('icon', 'save')}Enregistrer</k3-button>
        </div>
      </div>
    </section>`;
  }

  private renderDialogs(a: Application): unknown {
    const tpl = followupTemplate(a, this.store.state.profile);
    return html`
      <k3-dialog id="dlg-follow">
        <span slot="icon" class="ms" data-k3-icon="forward_to_inbox" aria-hidden="true"></span>
        <span slot="headline">Noter une relance</span>
        <div class="kd-dialog-body">
          <k3-chip-set selection="single" label="Canal" @k3-change=${(e: CustomEvent<{ values: string[] }>) => (this.followDraft = { ...this.followDraft, channel: e.detail.values[0] ?? 'email' })}>
            ${[['email', 'Email', 'mail'], ['linkedin', 'LinkedIn', 'chat'], ['phone', 'Téléphone', 'call'], ['site', 'Site carrière', 'language']].map(
              ([v, l, i]) => html`<k3-chip variant="filter" value=${v} ?selected=${this.followDraft.channel === v}>${slotIc('icon', i)}${l}</k3-chip>`,
            )}
          </k3-chip-set>
          <k3-textarea variant="outlined" label="Message ou résumé (optionnel)" rows="4" .value=${this.followDraft.body} @k3-input=${(e: Event) => (this.followDraft = { ...this.followDraft, body: evValue(e) })}></k3-textarea>
          <k3-button variant="text" size="sm" @click=${() => (this.followDraft = { ...this.followDraft, body: `${tpl.subject}\n\n${tpl.body}` })}>${slotIc('icon', 'auto_fix_high')}Insérer le modèle « ${tpl.kind} »</k3-button>
          <p class="kd-hint">La prochaine relance sera programmée selon tes délais (Réglages).</p>
        </div>
        <k3-button slot="actions" variant="text" @click=${() => closeDialog(this, 'dlg-follow')}>Annuler</k3-button>
        <k3-button slot="actions" variant="filled" @click=${() => this.logFollowup()}>Enregistrer</k3-button>
      </k3-dialog>

      <k3-dialog id="dlg-interview">
        <span slot="icon" class="ms" data-k3-icon="event" aria-hidden="true"></span>
        <span slot="headline">Planifier un entretien</span>
        <div class="kd-dialog-body kd-form">
          <k3-text-field variant="outlined" type="datetime-local" label="Date et heure" .value=${this.interviewDraft.at} @k3-input=${(e: Event) => (this.interviewDraft = { ...this.interviewDraft, at: evValue(e) })}></k3-text-field>
          <k3-text-field variant="outlined" label="Type" .value=${this.interviewDraft.title} @k3-input=${(e: Event) => (this.interviewDraft = { ...this.interviewDraft, title: evValue(e) })}></k3-text-field>
          <k3-text-field variant="outlined" label="Lieu / lien visio" .value=${this.interviewDraft.location} @k3-input=${(e: Event) => (this.interviewDraft = { ...this.interviewDraft, location: evValue(e) })}></k3-text-field>
          <k3-textarea variant="outlined" label="Préparation (interlocuteurs, questions…)" rows="3" .value=${this.interviewDraft.body} @k3-input=${(e: Event) => (this.interviewDraft = { ...this.interviewDraft, body: evValue(e) })}></k3-textarea>
        </div>
        <k3-button slot="actions" variant="text" @click=${() => closeDialog(this, 'dlg-interview')}>Annuler</k3-button>
        <k3-button slot="actions" variant="filled" @click=${() => this.addInterview()}>Planifier</k3-button>
      </k3-dialog>

      <k3-dialog id="dlg-note">
        <span slot="icon" class="ms" data-k3-icon="sticky_note_2" aria-hidden="true"></span>
        <span slot="headline">Ajouter à l’historique</span>
        <div class="kd-dialog-body kd-form">
          <k3-select variant="outlined" label="Type" .value=${this.noteDraft.type} @k3-change=${(e: Event) => (this.noteDraft = { ...this.noteDraft, type: evValue(e) })}>
            <k3-menu-item value="note">Note</k3-menu-item>
            <k3-menu-item value="email">Email reçu / envoyé</k3-menu-item>
            <k3-menu-item value="call">Appel</k3-menu-item>
          </k3-select>
          <k3-text-field variant="outlined" label="Titre" .value=${this.noteDraft.title} @k3-input=${(e: Event) => (this.noteDraft = { ...this.noteDraft, title: evValue(e) })}></k3-text-field>
          <k3-textarea variant="outlined" label="Détails" rows="4" .value=${this.noteDraft.body} @k3-input=${(e: Event) => (this.noteDraft = { ...this.noteDraft, body: evValue(e) })}></k3-textarea>
        </div>
        <k3-button slot="actions" variant="text" @click=${() => closeDialog(this, 'dlg-note')}>Annuler</k3-button>
        <k3-button slot="actions" variant="filled" @click=${() => this.addNote()}>Ajouter</k3-button>
      </k3-dialog>

      <k3-dialog id="dlg-delete">
        <span slot="icon" class="ms" data-k3-icon="delete" aria-hidden="true"></span>
        <span slot="headline">Supprimer cette candidature ?</span>
        <p>« ${a.title} » et tout son historique seront supprimés. L’offre liée reste dans ta veille.</p>
        <k3-button slot="actions" variant="text" @click=${() => closeDialog(this, 'dlg-delete')}>Annuler</k3-button>
        <k3-button slot="actions" variant="filled" @click=${() => this.removeApp()}>Supprimer</k3-button>
      </k3-dialog>`;
  }

  protected override render(): unknown {
    const a = this.app;
    if (!a) return html`<div class="kd-page">${loading()}</div>`;
    const m = statusMeta(a.status);
    return html`<div class="kd-page">
      <header class="kd-page-head" style="align-items:flex-start">
        <div class="row nowrap" style="align-items:flex-start;gap:1rem;min-width:0">
          <k3-icon-button variant="tonal" label="Retour" @click=${() => (history.length > 1 ? history.back() : navigate('/applications'))}>${ic('arrow_back')}</k3-icon-button>
          <div style="min-width:0">
            <div class="t-overline">${[a.company, sourceLabel(a.source)].filter(Boolean).join(' · ') || 'Candidature'}</div>
            <h1 class="t-headline">${a.title}</h1>
            <div class="row" style="margin-top:.5rem">
              <span class="kd-tag secondary">${ic(m.icon)}${m.label}</span>
              ${a.location ? html`<span class="kd-tag">${ic('location_on')}${a.location}</span>` : nothing}
              ${a.contract ? html`<span class="kd-tag">${a.contract}</span>` : nothing}
              ${a.salaryText ? html`<span class="kd-tag">${ic('payments')}${a.salaryText}</span>` : nothing}
              ${a.appliedAt ? html`<span class="kd-tag outline">${ic('send')}envoyée le ${fmtDate(a.appliedAt)}</span>` : nothing}
            </div>
          </div>
        </div>
        <div class="actions">
          <kd-score .value=${a.matchScore}></kd-score>
          <k3-select variant="outlined" label="Statut" style="min-width:12rem" .value=${a.status} @k3-change=${(e: Event) => this.patchApp({ status: evValue(e) as AppStatus }, 'Statut mis à jour')}>
            ${APP_STATUSES.map((s) => html`<k3-menu-item value=${s.id}>${s.label}</k3-menu-item>`)}
          </k3-select>
          ${a.url ? html`<k3-icon-button variant="tonal" label="Ouvrir l’annonce" @click=${() => window.open(a.url, '_blank', 'noopener')}>${ic('open_in_new')}</k3-icon-button>` : nothing}
          <k3-icon-button variant="standard" label="Supprimer" @click=${() => openDialog(this, 'dlg-delete')}>${ic('delete')}</k3-icon-button>
        </div>
      </header>

      <k3-tabs
        class="kd-tabs"
        variant="secondary"
        labels="Suivi,Analyse du match,Infos & contact"
        icons="timeline,neurology,edit_note"
        .index=${TABS.indexOf(this.tab)}
        @k3-change=${(e: CustomEvent<{ index: number }>) => {
          this.tab = TABS[e.detail.index] ?? 'suivi';
          setQuery({ tab: this.tab === 'suivi' ? null : this.tab });
        }}
      ></k3-tabs>

      ${this.tab === 'suivi'
        ? html`<div class="kd-split">
            <div class="stack loose">${this.renderTimeline()}</div>
            <div class="stack loose">
              ${this.renderFollowupCard(a)}
              <section class="kd-surface">
                <h2 class="kd-section-title t-title-m">${ic('low_priority')} Priorité</h2>
                <k3-button-segmented
                  aria-label="Priorité"
                  .segments=${[
                    { label: 'Basse', value: '1' },
                    { label: 'Normale', value: '2' },
                    { label: 'Haute', value: '3' },
                  ]}
                  .selectedIndices=${[a.priority - 1]}
                  @k3-change=${(e: CustomEvent<{ values: string[] }>) => this.patchApp({ priority: Number(e.detail.values[0]) as 1 | 2 | 3 })}
                ></k3-button-segmented>
              </section>
              ${a.contactName || a.contactEmail
                ? html`<section class="kd-surface">
                    <h2 class="kd-section-title t-title-m">${ic('contact_mail')} Contact</h2>
                    <div class="row nowrap">
                      <k3-avatar name=${a.contactName || a.contactEmail} size="md"></k3-avatar>
                      <div style="min-width:0">
                        <div class="t-label">${a.contactName}</div>
                        <div class="muted ellipsis">${[a.contactRole, a.contactEmail, a.contactPhone].filter(Boolean).join(' · ')}</div>
                      </div>
                    </div>
                  </section>`
                : nothing}
            </div>
          </div>`
        : this.tab === 'analyse'
          ? this.renderAnalysis(a)
          : this.renderInfos()}
      ${this.renderDialogs(a)}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kd-application-detail': KdApplicationDetail;
  }
}

