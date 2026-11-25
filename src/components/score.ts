import { html, svg, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MATERIAL_SHAPE_SVG } from '@k3ui/shapes/material-shapes-svg.js';
import { animateMaterialShapeMorph } from '@k3ui/shapes/morph.js';
import { prefersReducedMotion } from '@k3ui/core/index.js';
import { LightElement } from './base.js';
import { scoreShape, scoreTone } from '../lib/ui.js';

/**
 * Match score inside an M3 Expressive shape. The shape morphs when the score
 * changes band (Ghostish → Pentagon → Cookie9 → Cookie12) and the number counts up.
 */
@customElement('kd-score')
export class KdScore extends LightElement {
  @property({ type: Number }) value: number | null = null;
  @property({ reflect: true }) size: 's' | 'm' | 'l' = 'm';
  @property({ reflect: true }) tone = 'none';
  @state() private path = MATERIAL_SHAPE_SVG.Circle;
  @state() private shown = 0;
  private abort?: AbortController;

  private morphing = false;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has('value')) return;
    this.tone = scoreTone(this.value);
    const prev = changed.get('value') as number | null | undefined;
    // First paint and reduced motion: final state right away (no extra update cycle).
    this.morphing = prev !== undefined && !prefersReducedMotion() && this.size !== 's';
    if (!this.morphing) {
      this.path = MATERIAL_SHAPE_SVG[scoreShape(this.value)];
      this.shown = this.value ?? 0;
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has('value') || !this.morphing) return;
    const prev = changed.get('value') as number | null | undefined;
    const from = scoreShape(prev ?? null);
    const to = scoreShape(this.value);
    this.abort?.abort();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    if (from !== to) void animateMaterialShapeMorph({ from, to, duration: 650, onFrame: (d) => (this.path = d), signal });
    else this.path = MATERIAL_SHAPE_SVG[to];
    const target = this.value ?? 0;
    const start = performance.now();
    const origin = this.shown;
    const tick = (now: number): void => {
      if (signal.aborted) return;
      const u = Math.min(1, (now - start) / 700);
      this.shown = Math.round(origin + (target - origin) * (1 - Math.pow(1 - u, 3)));
      if (u < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.abort?.abort();
  }

  protected override render(): unknown {
    const label = this.value == null ? 'Score inconnu' : `Score de correspondance ${this.value} %`;
    return html`<div class="wrap" role="img" aria-label=${label} title=${label}>
      <svg viewBox="0 0 1 1" aria-hidden="true">${svg`<path d=${this.path}></path>`}</svg>
      <span class="num">${this.value == null ? '–' : html`${this.shown}<small>%</small>`}</span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kd-score': KdScore;
  }
}
