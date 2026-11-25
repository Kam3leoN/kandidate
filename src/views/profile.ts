import { html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { analyzeAd, CATEGORY_LABELS, SKILLS, canonicalSkillId, findSkill } from '../../shared/analysis/index.js';
import { CONTRACT_TYPES, type ContractType, type Profile, type ProfileLanguage, type ProfileSkill } from '../../shared/types.js';
import { LightElement } from '../components/base.js';
import '../components/fields.js';
import { put } from '../lib/api.js';
import { store } from '../lib/store.js';
import { evValue, ic, slotIc, toast, toastError } from '../lib/ui.js';

const TITLE_SUGGESTIONS = [
  'Développeur front-end', 'Développeur full-stack', 'Développeur back-end', 'Lead développeur', 'Product designer', 'UX/UI designer', 'Chef de projet digital',
  'Product owner', 'Product manager', 'Data analyst', 'Data scientist', 'Ingénieur DevOps', 'Consultant', 'Responsable marketing digital', 'Chargé de communication',
  'Business developer', 'Commercial B2B', 'Responsable commercial', 'Animateur de réseau', 'Responsable franchise', 'Chargé de recrutement', 'Contrôleur de gestion',
];
const LANG_LEVELS: ProfileLanguage['level'][] = ['notions', 'intermédiaire', 'courant', 'bilingue', 'natif'];
const EDU = [
  [null, 'Non précisé'],
  [0, 'Bac'],
  [2, 'Bac+2'],
  [3, 'Bac+3'],
  [5, 'Bac+5'],
  [8, 'Doctorat'],
] as const;

@customElement('kd-profile')
export class KdProfile extends LightElement {
  @state() private p: Profile = { ...store.state.profile };
  @state() private dirty = false;
  @state() private saving = false;
  @state() private cvSuggestions: string[] = [];
  @state() private skillDraft = '';

  override connectedCallback(): void {
    super.connectedCallback();
    this.p = structuredClone(store.state.profile);
    window.addEventListener('beforeunload', this.guard);
  }
  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('beforeunload', this.guard);
  }
  private guard = (e: BeforeUnloadEvent): void => {
    if (this.dirty) e.preventDefault();
  };

  private set(patch: Partial<Profile>): void {
    this.p = { ...this.p, ...patch };
    this.dirty = true;
  }

  private async save(): Promise<void> {
    this.saving = true;
    try {
      const r = await put<{ profile: Profile; rescored: number }>('/profile', this.p);
      store.set({ profile: r.profile });
      this.p = structuredClone(r.profile);
      this.dirty = false;
      toast('Profil enregistré', { icon: 'check_circle', supportingText: r.rescored ? `${r.rescored} offres re-scorées avec ton nouveau profil` : undefined });
    } catch (e) {
      toastError(e);
    } finally {
      this.saving = false;
    }
  }

  private addSkill(name: string, level = 3): void {
    const n = name.trim();
    if (!n) return;
    const label = findSkill(n)?.label ?? n;
    if (this.p.skills.some((s) => canonicalSkillId(s.name) === canonicalSkillId(label))) return;
    this.set({ skills: [...this.p.skills, { name: label, level, core: false }] });
  }

  private updateSkill(i: number, patch: Partial<ProfileSkill>): void {
    this.set({ skills: this.p.skills.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  }

  private detectFromCv(): void {
    if (this.p.cvText.trim().length < 80) return toast('Colle d’abord le texte de ton CV', { icon: 'error' });
    const a = analyzeAd({ text: this.p.cvText });
    const have = new Set(this.p.skills.map((s) => canonicalSkillId(s.name)));
    this.cvSuggestions = [...a.skills, ...a.softSkills].filter((s) => !have.has(s.id)).map((s) => s.label);
    if (!this.p.experienceYears && a.experience?.min) this.set({ experienceYears: a.experience.min });
    toast(this.cvSuggestions.length ? `${this.cvSuggestions.length} compétence(s) détectée(s)` : 'Aucune nouvelle compétence détectée', { icon: 'auto_awesome' });
  }

  private renderSkills(): unknown {
    const q = this.skillDraft.toLowerCase();
    const sugg = q ? SKILLS.filter((s) => s.label.toLowerCase().includes(q) || s.aliases.some((a) => a.includes(q))).slice(0, 8) : [];
    const groups = new Map<string, Array<[ProfileSkill, number]>>();
    this.p.skills.forEach((s, i) => {
      const cat = findSkill(s.name)?.cat;
      const label = cat ? CATEGORY_LABELS[cat] : 'Mes compétences spécifiques';
      groups.set(label, [...(groups.get(label) ?? []), [s, i]]);
    });
    return html`<section class="kd-surface stack">
      <h2 class="kd-section-title t-title-m">${ic('psychology')} Compétences <span class="grow"></span><span class="kd-tag outline">${this.p.skills.length}</span></h2>
      <p class="kd-hint">Le niveau (1 à 5) pondère le score ; l’étoile marque tes compétences clés (bonus quand elles apparaissent dans l’intitulé). Toute compétence ajoutée ici est aussi détectée dans les annonces.</p>
      <div class="kd-autocomplete">
        <k3-text-field variant="outlined" label="Ajouter une compétence (ex. React, Figma, négociation…)" .value=${this.skillDraft}
          @k3-input=${(e: Event) => (this.skillDraft = evValue(e))}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' && this.skillDraft.trim()) {
              this.addSkill(this.skillDraft);
              this.skillDraft = '';
            }
          }}>${slotIc('leading-icon', 'add')}</k3-text-field>
        ${sugg.length
          ? html`<div class="kd-suggest">${sugg.map(
              (s) => html`<button type="button" @mousedown=${(e: Event) => e.preventDefault()} @click=${() => {
                this.addSkill(s.label);
                this.skillDraft = '';
              }}>${ic('add')}<span>${s.label}</span><span class="grow"></span><span class="kd-hint">${CATEGORY_LABELS[s.cat]}</span></button>`,
            )}</div>`
          : nothing}
      </div>
      ${[...groups.entries()].map(
        ([label, list]) => html`<div>
          <div class="t-overline" style="margin-bottom:.5rem">${label}</div>
          <div class="kd-grid" style="grid-template-columns:repeat(auto-fill,minmax(15.5rem,1fr));gap:.5rem">
            ${list.map(
              ([s, i]) => html`<div class="kd-item" style="cursor:default;padding:.5rem .5rem .5rem .875rem;border-radius:var(--kd-radius-l)">
                <span class="body"><div class="title" style="font-weight:600">${s.name}</div>
                  <div class="row nowrap" style="gap:2px;margin-top:2px" role="radiogroup" aria-label="Niveau ${s.name}">
                    ${[1, 2, 3, 4, 5].map(
                      (n) => html`<button type="button" class="kd-lvl" role="radio" aria-checked=${n === s.level} aria-label="Niveau ${n}" @click=${() => this.updateSkill(i, { level: n })}
                        style="border:0;padding:0;width:1.375rem;height:.5rem;border-radius:99px;cursor:pointer;background:${n <= s.level ? 'var(--k3-sys-color-primary)' : 'var(--k3-sys-color-surface-container-highest)'}"></button>`,
                    )}
                  </div>
                </span>
                <k3-icon-button variant="standard" size="sm" toggle ?selected=${!!s.core} label="Compétence clé" @k3-change=${(e: CustomEvent<{ selected: boolean }>) => this.updateSkill(i, { core: e.detail.selected })}>
                  ${ic('star')}<span slot="selected-icon" class="ms" data-k3-icon="star" style="--k3-sys-icon-fill:1;color:var(--k3-sys-color-tertiary)" aria-hidden="true"></span>
                </k3-icon-button>
                <k3-icon-button variant="standard" size="sm" label="Retirer ${s.name}" @click=${() => this.set({ skills: this.p.skills.filter((_, j) => j !== i) })}>${ic('close')}</k3-icon-button>
              </div>`,
            )}
          </div>
        </div>`,
      )}
    </section>`;
  }

  protected override render(): unknown {
    const p = this.p;
    return html`<div class="kd-page">
      <header class="kd-page-head">
        <div>
          <div class="t-overline">Matching</div>
          <h1 class="t-display">Mon profil</h1>
          <p class="muted" style="margin-top:.5rem;max-width:44rem">Ces informations servent uniquement au calcul local des scores de match et aux modèles de relance.</p>
        </div>
        <div class="actions">
          ${this.dirty ? html`<span class="kd-tag warning">${ic('edit')}Non enregistré</span>` : nothing}
          <k3-button variant="filled" size="md" ?disabled=${!this.dirty || this.saving} @click=${() => this.save()}>${slotIc('icon', 'save')}${this.saving ? 'Enregistrement…' : 'Enregistrer'}</k3-button>
        </div>
      </header>

      <div class="kd-split">
        <div class="stack loose">
          <section class="kd-surface kd-form">
            <h2 class="kd-section-title t-title-m">${ic('person')} Identité</h2>
            <div class="two">
              <k3-text-field variant="outlined" label="Nom complet" .value=${p.fullName} @k3-input=${(e: Event) => this.set({ fullName: evValue(e) })}></k3-text-field>
              <k3-text-field variant="outlined" label="Titre (signature)" .value=${p.headline} @k3-input=${(e: Event) => this.set({ headline: evValue(e) })}></k3-text-field>
            </div>
            <div class="two">
              <k3-text-field variant="outlined" type="email" label="Email" .value=${p.email} @k3-input=${(e: Event) => this.set({ email: evValue(e) })}></k3-text-field>
              <k3-text-field variant="outlined" type="tel" label="Téléphone" .value=${p.phone} @k3-input=${(e: Event) => this.set({ phone: evValue(e) })}></k3-text-field>
            </div>
          </section>

          <section class="kd-surface kd-form">
            <h2 class="kd-section-title t-title-m">${ic('target')} Postes visés</h2>
            <kd-chips-input label="Intitulés recherchés" icon="work" .values=${p.targetTitles} .suggestions=${TITLE_SUGGESTIONS} @kd-change=${(e: CustomEvent<string[]>) => this.set({ targetTitles: e.detail })}></kd-chips-input>
            <div>
              <div class="kd-field-label">Contrats acceptés</div>
              <k3-chip-set selection="multi" label="Contrats" @k3-change=${(e: CustomEvent<{ values: string[] }>) => this.set({ contracts: e.detail.values as ContractType[] })}>
                ${CONTRACT_TYPES.map((c) => html`<k3-chip variant="filter" value=${c} ?selected=${p.contracts.includes(c)}>${c}</k3-chip>`)}
              </k3-chip-set>
            </div>
            <div class="two">
              <div>
                <div class="kd-field-label">Expérience : ${p.experienceYears} an${p.experienceYears > 1 ? 's' : ''}</div>
                <k3-slider min="0" max="30" step="1" .value=${p.experienceYears} aria-label="Années d’expérience" @k3-change=${(e: CustomEvent<{ value: number }>) => this.set({ experienceYears: e.detail.value })}></k3-slider>
              </div>
              <k3-select variant="outlined" label="Niveau d’études" .value=${p.educationLevel == null ? '' : String(p.educationLevel)} @k3-change=${(e: Event) => this.set({ educationLevel: evValue(e) === '' ? null : Number(evValue(e)) })}>
                ${EDU.map(([v, l]) => html`<k3-menu-item value=${v == null ? '' : String(v)}>${l}</k3-menu-item>`)}
              </k3-select>
            </div>
            <div class="two">
              <k3-text-field variant="outlined" type="number" label="Salaire minimum (€ brut/an)" .value=${p.salaryMin ? String(p.salaryMin) : ''} @k3-input=${(e: Event) => this.set({ salaryMin: Number(evValue(e)) || null })}>${slotIc('leading-icon', 'payments')}</k3-text-field>
              <k3-text-field variant="outlined" type="number" label="Salaire cible (€ brut/an)" .value=${p.salaryTarget ? String(p.salaryTarget) : ''} @k3-input=${(e: Event) => this.set({ salaryTarget: Number(evValue(e)) || null })}>${slotIc('leading-icon', 'trending_up')}</k3-text-field>
            </div>
          </section>

          ${this.renderSkills()}

          <section class="kd-surface kd-form">
            <h2 class="kd-section-title t-title-m">${ic('description')} CV (texte brut)</h2>
            <k3-textarea variant="outlined" label="Colle le texte de ton CV" rows="7" .value=${p.cvText} @k3-input=${(e: Event) => this.set({ cvText: evValue(e) })}></k3-textarea>
            <div class="row">
              <k3-button variant="tonal" @click=${() => this.detectFromCv()}>${slotIc('icon', 'auto_awesome')}Détecter mes compétences</k3-button>
              <span class="kd-hint">Sert aussi à repérer les mots-clés d’une annonce absents de ton CV (ATS).</span>
            </div>
            ${this.cvSuggestions.length
              ? html`<div class="row">
                  ${this.cvSuggestions.map(
                    (s) => html`<k3-chip variant="suggestion" @click=${() => {
                      this.addSkill(s);
                      this.cvSuggestions = this.cvSuggestions.filter((x) => x !== s);
                    }}>${slotIc('icon', 'add')}${s}</k3-chip>`,
                  )}
                  <k3-button variant="text" size="sm" @click=${() => {
                    this.cvSuggestions.forEach((s) => this.addSkill(s));
                    this.cvSuggestions = [];
                  }}>Tout ajouter</k3-button>
                </div>`
              : nothing}
          </section>
        </div>

        <div class="stack loose">
          <section class="kd-surface kd-form">
            <h2 class="kd-section-title t-title-m">${ic('location_on')} Mobilité</h2>
            <kd-geo-field .value=${p.location} label="Ville de résidence" @kd-change=${(e: CustomEvent) => this.set({ location: e.detail })}></kd-geo-field>
            <div>
              <div class="kd-field-label">Distance max. : ${p.mobilityKm} km</div>
              <k3-slider min="0" max="200" step="5" .value=${p.mobilityKm} aria-label="Mobilité" @k3-change=${(e: CustomEvent<{ value: number }>) => this.set({ mobilityKm: e.detail.value })}></k3-slider>
            </div>
            <div>
              <div class="kd-field-label">Télétravail souhaité</div>
              <k3-button-segmented
                aria-label="Télétravail souhaité"
                .segments=${[
                  { label: 'Indifférent', value: 'any' },
                  { label: 'Sur site', value: 'onsite' },
                  { label: 'Hybride', value: 'hybrid' },
                  { label: 'Full remote', value: 'remote' },
                ]}
                .selectedIndices=${[['any', 'onsite', 'hybrid', 'remote'].indexOf(p.remotePref)]}
                @k3-change=${(e: CustomEvent<{ values: string[] }>) => this.set({ remotePref: (e.detail.values[0] as Profile['remotePref']) ?? 'any' })}
              ></k3-button-segmented>
            </div>
          </section>

          <section class="kd-surface kd-form">
            <h2 class="kd-section-title t-title-m">${ic('translate')} Langues</h2>
            ${p.languages.map(
              (l, i) => html`<div class="row nowrap">
                <k3-text-field variant="outlined" label="Langue" style="flex:1" .value=${l.name} @k3-input=${(e: Event) => this.set({ languages: p.languages.map((x, j) => (j === i ? { ...x, name: evValue(e) } : x)) })}></k3-text-field>
                <k3-select variant="outlined" label="Niveau" style="width:10rem" .value=${l.level} @k3-change=${(e: Event) => this.set({ languages: p.languages.map((x, j) => (j === i ? { ...x, level: evValue(e) as ProfileLanguage['level'] } : x)) })}>
                  ${LANG_LEVELS.map((lv) => html`<k3-menu-item value=${lv}>${lv}</k3-menu-item>`)}
                </k3-select>
                <k3-icon-button variant="standard" label="Retirer" @click=${() => this.set({ languages: p.languages.filter((_, j) => j !== i) })}>${ic('close')}</k3-icon-button>
              </div>`,
            )}
            <k3-button variant="text" @click=${() => this.set({ languages: [...p.languages, { name: 'Anglais', level: 'courant' }] })}>${slotIc('icon', 'add')}Ajouter une langue</k3-button>
          </section>

          <section class="kd-surface kd-form">
            <h2 class="kd-section-title t-title-m">${ic('block')} À éviter</h2>
            <kd-chips-input label="Mots-clés exclus" icon="block" placeholder="ex. astreintes, ESN, stage" .values=${p.excludedKeywords} @kd-change=${(e: CustomEvent<string[]>) => this.set({ excludedKeywords: e.detail })}></kd-chips-input>
            <p class="kd-hint">Une offre qui contient un de ces mots est plafonnée à 45 % et filtrée des alertes.</p>
          </section>
        </div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kd-profile': KdProfile;
  }
}
