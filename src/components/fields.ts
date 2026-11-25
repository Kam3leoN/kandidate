import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { GeoPoint } from '../../shared/types.js';
import { get } from '../lib/api.js';
import { debounce, evValue, ic, slotIc } from '../lib/ui.js';
import { LightElement } from './base.js';

/**
 * Commune / department autocomplete (geo.api.gouv.fr via /api/geo).
 * @fires kd-change — detail: GeoPoint | null
 */
@customElement('kd-geo-field')
export class KdGeoField extends LightElement {
  @property({ attribute: false }) value: GeoPoint | null = null;
  @property() label = 'Ville ou département';
  @state() private q = '';
  @state() private items: GeoPoint[] = [];
  @state() private open = false;

  private search = debounce(async (q: string) => {
    if (q.trim().length < 2) {
      this.items = [];
      return;
    }
    try {
      this.items = await get<GeoPoint[]>(`/geo?q=${encodeURIComponent(q)}`);
      this.open = this.items.length > 0;
    } catch {
      this.items = [];
    }
  }, 220);

  private pick(g: GeoPoint | null): void {
    this.value = g;
    this.q = '';
    this.open = false;
    this.dispatchEvent(new CustomEvent('kd-change', { detail: g, bubbles: true }));
  }

  protected override render(): unknown {
    const shown = this.q || this.value?.label || '';
    return html`<div class="kd-autocomplete" @focusout=${(e: FocusEvent) => {
      if (!this.contains(e.relatedTarget as Node)) setTimeout(() => (this.open = false), 120);
    }}>
      <k3-text-field
        variant="outlined"
        label=${this.label}
        .value=${shown}
        autocomplete="off"
        @k3-input=${(e: Event) => {
          this.q = evValue(e);
          if (!this.q) this.pick(null);
          else void this.search(this.q);
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'ArrowDown') (this.querySelector('.kd-suggest button') as HTMLButtonElement | null)?.focus();
          if (e.key === 'Escape') this.open = false;
        }}
      >
        ${slotIc('leading-icon', 'location_on')}
      </k3-text-field>
      ${this.open
        ? html`<div class="kd-suggest" role="listbox">
            ${this.items.map(
              (g) => html`<button type="button" role="option" @click=${() => this.pick(g)}>
                ${ic(g.insee ? 'location_city' : 'map')}<span>${g.label}</span>
              </button>`,
            )}
          </div>`
        : nothing}
    </div>`;
  }
}

/**
 * Free-form list as input chips (titles, keywords…) with optional suggestions.
 * @fires kd-change — detail: string[]
 */
@customElement('kd-chips-input')
export class KdChipsInput extends LightElement {
  @property({ attribute: false }) values: string[] = [];
  @property({ attribute: false }) suggestions: string[] = [];
  @property() label = 'Ajouter';
  @property() icon = 'add';
  @property() placeholder = '';
  @state() private draft = '';

  private emit(): void {
    this.dispatchEvent(new CustomEvent('kd-change', { detail: [...this.values], bubbles: true }));
  }

  private add(v: string): void {
    const parts = v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    const next = [...this.values];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    this.values = next;
    this.draft = '';
    const tf = this.querySelector('k3-text-field') as (HTMLElement & { value: string }) | null;
    if (tf) tf.value = '';
    this.emit();
  }

  protected override render(): unknown {
    const q = this.draft.toLowerCase();
    const sugg = q ? this.suggestions.filter((s) => s.toLowerCase().includes(q) && !this.values.includes(s)).slice(0, 6) : [];
    return html`<div class="stack tight">
      <div class="kd-autocomplete">
        <k3-text-field
          variant="outlined"
          label=${this.label}
          placeholder=${this.placeholder}
          .value=${this.draft}
          @k3-input=${(e: Event) => (this.draft = evValue(e))}
          @keydown=${(e: KeyboardEvent) => {
            if ((e.key === 'Enter' || e.key === ',') && this.draft.trim()) {
              e.preventDefault();
              this.add(this.draft);
            }
          }}
        >
          ${slotIc('leading-icon', this.icon)}
        </k3-text-field>
        ${sugg.length
          ? html`<div class="kd-suggest">${sugg.map((s) => html`<button type="button" @mousedown=${(e: Event) => e.preventDefault()} @click=${() => this.add(s)}>${ic('add')}${s}</button>`)}</div>`
          : nothing}
      </div>
      ${this.values.length
        ? html`<div class="row" role="list" aria-label=${this.label}>
            ${this.values.map(
              (v) => html`<k3-chip
                variant="input"
                removable
                value=${v}
                @k3-remove=${() => {
                  this.values = this.values.filter((x) => x !== v);
                  this.emit();
                }}
                >${v}</k3-chip
              >`,
            )}
          </div>`
        : nothing}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kd-geo-field': KdGeoField;
    'kd-chips-input': KdChipsInput;
  }
}
