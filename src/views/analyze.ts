import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { analyzeAd, matchProfile, type AdAnalysis, type MatchResult } from '../../shared/analysis/index.js';
import type { NormalizedOffer, Offer } from '../../shared/types.js';
import '../components/analysis-view.js';
import { LightElement } from '../components/base.js';
import { emptyState } from '../components/offer-card.js';
import { ApiError, post } from '../lib/api.js';
import { navigate, setQuery, type Route } from '../lib/router.js';
import { store, StoreController } from '../lib/store.js';
import { debounce, evValue, ic, shape, slotIc, toast, toastError } from '../lib/ui.js';

const MODES = ['text', 'url', 'email'] as const;
type Mode = (typeof MODES)[number];

@customElement('kd-analyze')
export class KdAnalyze extends LightElement {
  private store = new StoreController(this);
  @property({ attribute: false }) route!: Route;
  @state() private mode: Mode = 'text';
  @state() private text = '';
  @state() private url = '';
  @state() private emailRaw = '';
  @state() private busy = false;
  @state() private result: { analysis: AdAnalysis; match: MatchResult; offer?: NormalizedOffer } | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    const m = this.route?.query.get('mode');
    if (m && (MODES as readonly string[]).includes(m)) this.mode = m as Mode;
    try {
      this.text = sessionStorage.getItem('kd.analyze.text') ?? '';
    } catch {
      /* ignore */
    }
    if (this.text) this.analyzeLocal();
  }

  /** Instant analysis in the browser (same engine as the server). */
  private analyzeLocal(): void {
    if (this.text.trim().length < 60) {
      this.result = null;
      return;
    }
    const p = store.state.profile;
    const analysis = analyzeAd({ text: this.text, extraSkills: p.skills });
    this.result = { analysis, match: matchProfile(analysis, p, { text: this.text }) };
  }

  private analyzeDebounced = debounce(() => {
    this.analyzeLocal();
    try {
      sessionStorage.setItem('kd.analyze.text', this.text.slice(0, 50000));
    } catch {
      /* ignore */
    }
  }, 280);

  private async analyzeUrl(): Promise<void> {
    if (!/^https?:\/\//.test(this.url.trim())) return toast('Colle une URL complète (https://…)', { icon: 'error' });
    this.busy = true;
    try {
      this.result = await post<{ analysis: AdAnalysis; match: MatchResult; offer: NormalizedOffer }>('/analyze', { url: this.url.trim() });
    } catch (e) {
      if (e instanceof ApiError && (e.details as { pasteText?: boolean } | null)?.pasteText) {
        toast(e.message, { icon: 'content_paste', action: 'Coller le texte', onAction: () => this.setMode('text') });
      } else toastError(e);
    } finally {
      this.busy = false;
    }
  }

  private async importEmail(): Promise<void> {
    if (this.emailRaw.trim().length < 30) return toast('Colle le contenu de l’email d’alerte', { icon: 'error' });
    this.busy = true;
    try {
      const isHtml = /<a\s/i.test(this.emailRaw);
      const r = await post<{ found: number; inserted: number }>('/inbound/paste', isHtml ? { html: this.emailRaw } : { text: this.emailRaw });
      toast(r.found ? `${r.found} offre(s) trouvée(s), ${r.inserted} nouvelle(s)` : 'Aucune offre reconnue dans cet email', {
        icon: r.found ? 'mark_email_read' : 'warning',
        action: r.inserted ? 'Voir' : undefined,
        onAction: () => navigate('/offers?source=email'),
      });
      if (r.inserted) {
        this.emailRaw = '';
        void store.refreshUnread();
      }
    } catch (e) {
      toastError(e);
    } finally {
      this.busy = false;
    }
  }

  /** Store the analyzed ad (server-side normalization) and optionally track it. */
  private async keep(kind: 'save' | 'wishlist' | 'applied'): Promise<void> {
    this.busy = true;
    try {
      let offer = this.result?.offer;
      if (!offer || this.mode === 'text') {
        const r = await post<{ offer: NormalizedOffer }>('/analyze', { text: this.text, url: this.url || undefined });
        offer = r.offer;
      }
      const stored = await post<Offer>('/offers', { offer, status: 'saved' });
      if (kind === 'save') {
        toast('Offre enregistrée dans ta veille', { icon: 'bookmark_added', action: 'Voir', onAction: () => navigate(`/offers/${stored.id}`) });
        return;
      }
      const app = await post<{ id: number }>(`/offers/${stored.id}/apply`, { status: kind });
      window.dispatchEvent(new CustomEvent('kd:applications-changed'));
      toast(kind === 'applied' ? 'Candidature ajoutée — relance programmée' : 'Ajoutée à « À postuler »', { icon: 'add_task' });
      try {
        sessionStorage.removeItem('kd.analyze.text');
      } catch {
        /* ignore */
      }
      navigate(`/applications/${app.id}`);
    } catch (e) {
      toastError(e);
    } finally {
      this.busy = false;
    }
  }

  private setMode(m: Mode): void {
    this.mode = m;
    setQuery({ mode: m === 'text' ? null : m });
  }

  protected override render(): unknown {
    const profileEmpty = !this.store.state.profile.skills.length;
    return html`<div class="kd-page">
      <header class="kd-page-head">
        <div>
          <div class="t-overline">Analyse & match</div>
          <h1 class="t-display">Analyser une annonce</h1>
          <p class="muted" style="margin-top:.5rem;max-width:46rem">Colle le texte d’une annonce (LinkedIn, Cadremploi, APEC, Welcome to the Jungle, site carrière…) : contrat, salaire, télétravail, compétences demandées et score de match avec ton profil, calculés localement.</p>
        </div>
      </header>

      ${profileEmpty
        ? html`<k3-alert variant="tertiary" label="Profil incomplet" style="margin-bottom:1rem">Ajoute tes compétences et postes cibles pour un score pertinent.
            <k3-button slot="action" variant="text" size="sm" @click=${() => navigate('/profile')}>Compléter</k3-button></k3-alert>`
        : nothing}

      <section class="kd-surface" style="margin-bottom:var(--kd-gap)">
        <k3-button-segmented
          aria-label="Source de l’annonce"
          style="margin-bottom:1rem"
          .segments=${[
            { label: 'Texte', icon: 'notes', value: 'text' },
            { label: 'URL', icon: 'link', value: 'url' },
            { label: 'Alerte email', icon: 'forward_to_inbox', value: 'email' },
          ]}
          .selectedIndices=${[MODES.indexOf(this.mode)]}
          @k3-change=${(e: CustomEvent<{ values: string[] }>) => this.setMode((e.detail.values[0] as Mode) ?? 'text')}
        ></k3-button-segmented>

        ${this.mode === 'text'
          ? html`<label class="sr-only" for="kd-ad-text">Texte de l’annonce</label>
              <textarea
                id="kd-ad-text"
                class="kd-textarea"
                placeholder="Colle ici le texte complet de l’annonce…"
                .value=${this.text}
                @input=${(e: Event) => {
                  this.text = (e.target as HTMLTextAreaElement).value;
                  this.analyzeDebounced();
                }}
              ></textarea>
              <div class="row between" style="margin-top:.75rem">
                <span class="kd-hint">${ic('bolt')} Analyse instantanée dans ton navigateur — rien n’est envoyé tant que tu n’enregistres pas.</span>
                ${this.text ? html`<k3-button variant="text" size="sm" @click=${() => {
                  this.text = '';
                  this.result = null;
                  sessionStorage.removeItem('kd.analyze.text');
                }}>${slotIc('icon', 'backspace')}Effacer</k3-button>` : nothing}
              </div>`
          : this.mode === 'url'
            ? html`<div class="row nowrap" style="align-items:flex-start">
                  <k3-text-field style="flex:1" variant="outlined" type="url" label="URL de l’annonce" .value=${this.url} @k3-input=${(e: Event) => (this.url = evValue(e))} @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this.analyzeUrl()}>${slotIc('leading-icon', 'link')}</k3-text-field>
                  <k3-button variant="filled" size="md" ?disabled=${this.busy} @click=${() => this.analyzeUrl()}>${slotIc('icon', 'neurology')}${this.busy ? 'Lecture…' : 'Analyser'}</k3-button>
                </div>
                <p class="kd-hint" style="margin-top:.75rem">KandiDate lit la fiche structurée (schema.org JobPosting) publiée par la plupart des sites carrière et job boards. LinkedIn et Indeed bloquent la lecture automatique : colle alors le texte.</p>`
            : html`<textarea class="kd-textarea" style="min-height:10rem" placeholder="Colle ici le contenu (ou le code source HTML) d’un email d’alerte LinkedIn, Cadremploi, APEC, Indeed, HelloWork…" .value=${this.emailRaw} @input=${(e: Event) => (this.emailRaw = (e.target as HTMLTextAreaElement).value)}></textarea>
                <div class="row between" style="margin-top:.75rem">
                  <span class="kd-hint">${ic('info')} Automatise-le : transfère tes alertes vers ton adresse de réception (Réglages → Sources).</span>
                  <k3-button variant="filled" ?disabled=${this.busy} @click=${() => this.importEmail()}>${slotIc('icon', 'download')}Importer les offres</k3-button>
                </div>`}
      </section>

      ${this.mode !== 'email' && this.result
        ? html`<div class="row" style="margin-bottom:var(--kd-gap);justify-content:flex-end">
              <k3-button variant="text" ?disabled=${this.busy} @click=${() => this.keep('save')}>${slotIc('icon', 'bookmark_add')}Sauvegarder</k3-button>
              <k3-button variant="tonal" ?disabled=${this.busy} @click=${() => this.keep('wishlist')}>${slotIc('icon', 'add_task')}À postuler</k3-button>
              <k3-button variant="filled" ?disabled=${this.busy} @click=${() => this.keep('applied')}>${slotIc('icon', 'send')}J’ai postulé</k3-button>
            </div>
            <kd-analysis .analysis=${this.result.analysis} .match=${this.result.match}></kd-analysis>`
        : this.mode === 'text' && !this.text
          ? html`<div class="kd-grid cols-3 kd-stagger">
              ${[
                ['Cookie9Sided', 'payments', 'Salaire & contrat', 'Fourchettes en k€, mensuel, TJM ou format France Travail, CDI/CDD/freelance/alternance.'],
                ['Clover4Leaf', 'psychology', 'Compétences', 'Plus de 160 compétences + les tiennes, classées « demandées » ou « appréciées ».'],
                ['Sunny', 'tips_and_updates', 'Conseils', 'Écarts à combler, mots-clés ATS absents de ton CV, points de négociation.'],
              ].map(
                ([sh, icon, t, d]) => html`<div class="kd-surface row nowrap" style="align-items:flex-start;gap:1rem">
                  <span class="kd-shape-icon">${shape(sh as 'Sunny')}${ic(icon)}</span>
                  <div><div class="t-title-m">${t}</div><p class="muted" style="margin-top:.25rem">${d}</p></div>
                </div>`,
              )}
            </div>`
          : this.mode === 'text' && this.text.trim().length < 60
            ? emptyState('short_text', 'Encore un peu de texte…', 'Colle l’annonce complète pour une analyse fiable.')
            : nothing}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kd-analyze': KdAnalyze;
  }
}
