import { html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { APP_STATUSES, CONTRACT_TYPES, type Application } from '../../shared/types.js';
import { post } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { closeDialog, evValue, openDialog, slotIc, toast, toastError } from '../lib/ui.js';
import { LightElement } from './base.js';

const EMPTY: Partial<Application> = { title: '', company: '', location: '', url: '', status: 'applied', priority: 2, contract: 'CDI', salaryText: '', contactName: '', contactEmail: '', notes: '', description: '' };

/** Global "new application" dialog — open with `window.dispatchEvent(new CustomEvent('kd:new-application', { detail }))`. */
@customElement('kd-new-application')
export class KdNewApplication extends LightElement {
  @state() private draft: Partial<Application> = { ...EMPTY };
  @state() private busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('kd:new-application', this.onOpen as unknown as EventListener);
  }
  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('kd:new-application', this.onOpen as unknown as EventListener);
  }

  private onOpen = async (e: CustomEvent<Partial<Application> | undefined>): Promise<void> => {
    this.draft = { ...EMPTY, ...(e.detail ?? {}) };
    await this.updateComplete;
    await openDialog(this, 'kd-new-app');
  };

  private set<K extends keyof Application>(k: K, v: Application[K]): void {
    this.draft = { ...this.draft, [k]: v };
  }

  private async submit(): Promise<void> {
    if (!this.draft.title?.trim()) {
      toast('Indique au moins l’intitulé du poste', { icon: 'error' });
      return;
    }
    this.busy = true;
    try {
      const app = await post<Application>('/applications', this.draft);
      await closeDialog(this, 'kd-new-app');
      window.dispatchEvent(new CustomEvent('kd:applications-changed'));
      toast('Candidature ajoutée au suivi', { icon: 'check_circle', action: 'Ouvrir', onAction: () => navigate(`/applications/${app.id}`) });
    } catch (e) {
      toastError(e);
    } finally {
      this.busy = false;
    }
  }

  protected override render(): unknown {
    const d = this.draft;
    return html`<k3-dialog id="kd-new-app" variant="basic">
      <span slot="icon" class="ms" data-k3-icon="post_add" aria-hidden="true"></span>
      <span slot="headline">Nouvelle candidature</span>
      <div class="kd-form kd-dialog-body">
        <k3-text-field variant="outlined" label="Intitulé du poste" required .value=${d.title ?? ''} @k3-input=${(e: Event) => this.set('title', evValue(e))}></k3-text-field>
        <div class="two">
          <k3-text-field variant="outlined" label="Entreprise" .value=${d.company ?? ''} @k3-input=${(e: Event) => this.set('company', evValue(e))}></k3-text-field>
          <k3-text-field variant="outlined" label="Lieu" .value=${d.location ?? ''} @k3-input=${(e: Event) => this.set('location', evValue(e))}></k3-text-field>
        </div>
        <div class="two">
          <k3-select variant="outlined" label="Statut" .value=${d.status ?? 'applied'} @k3-change=${(e: Event) => this.set('status', evValue(e) as Application['status'])}>
            ${APP_STATUSES.filter((s) => s.open).map((s) => html`<k3-menu-item value=${s.id}>${s.label}</k3-menu-item>`)}
          </k3-select>
          <k3-select variant="outlined" label="Contrat" .value=${d.contract ?? 'CDI'} @k3-change=${(e: Event) => this.set('contract', evValue(e) as Application['contract'])}>
            ${CONTRACT_TYPES.map((c) => html`<k3-menu-item value=${c}>${c}</k3-menu-item>`)}
          </k3-select>
        </div>
        <k3-text-field variant="outlined" type="url" label="Lien de l’annonce" .value=${d.url ?? ''} @k3-input=${(e: Event) => this.set('url', evValue(e))}>${slotIc('leading-icon', 'link')}</k3-text-field>
        <div class="two">
          <k3-text-field variant="outlined" label="Contact (recruteur)" .value=${d.contactName ?? ''} @k3-input=${(e: Event) => this.set('contactName', evValue(e))}></k3-text-field>
          <k3-text-field variant="outlined" type="email" label="Email du contact" .value=${d.contactEmail ?? ''} @k3-input=${(e: Event) => this.set('contactEmail', evValue(e))}></k3-text-field>
        </div>
        <k3-text-field variant="outlined" label="Salaire annoncé" .value=${d.salaryText ?? ''} @k3-input=${(e: Event) => this.set('salaryText', evValue(e))}></k3-text-field>
        <k3-textarea variant="outlined" label="Texte de l’annonce (pour l’analyse)" rows="4" .value=${d.description ?? ''} @k3-input=${(e: Event) => this.set('description', evValue(e))}></k3-textarea>
      </div>
      <k3-button slot="actions" variant="text" @click=${() => closeDialog(this, 'kd-new-app')}>Annuler</k3-button>
      <k3-button slot="actions" variant="filled" ?disabled=${this.busy} @click=${() => this.submit()}>${slotIc('icon', 'check')}Ajouter</k3-button>
    </k3-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kd-new-application': KdNewApplication;
  }
}
