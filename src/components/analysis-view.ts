import { html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AdAnalysis, MatchResult } from '../../shared/analysis/index.js';
import { fmtK, ic, remoteLabel } from '../lib/ui.js';
import { LightElement } from './base.js';
import './score.js';

const VERDICT: Record<MatchResult['verdict'], { label: string; tone: string; icon: string }> = {
  excellent: { label: 'Excellent match', tone: 'primary', icon: 'auto_awesome' },
  bon: { label: 'Bon match', tone: 'secondary', icon: 'thumb_up' },
  moyen: { label: 'Match partiel', tone: 'tertiary', icon: 'balance' },
  faible: { label: 'Match faible', tone: 'error', icon: 'trending_down' },
};

const EDU: Record<number, string> = { 0: 'Bac', 2: 'Bac+2', 3: 'Bac+3', 4: 'Bac+4', 5: 'Bac+5', 8: 'Doctorat' };

/** Full analysis of an ad: score, breakdown, skills gap, signals and advice. */
@customElement('kd-analysis')
export class KdAnalysis extends LightElement {
  @property({ attribute: false }) analysis: AdAnalysis | null = null;
  @property({ attribute: false }) match: MatchResult | null = null;
  /** Hide the header (when the page already shows title + score). */
  @property({ type: Boolean, attribute: 'no-header' }) noHeader = false;

  private fact(icon: string, k: string, v: unknown): unknown {
    if (v === null || v === undefined || v === '') return nothing;
    return html`<div class="kd-fact"><div class="k">${ic(icon)}${k}</div><div class="v">${v}</div></div>`;
  }

  protected override render(): unknown {
    const a = this.analysis;
    const m = this.match;
    if (!a || !m) return nothing;
    const v = VERDICT[m.verdict];
    const sal = a.salary;
    const salary = sal ? (sal.annualMin && sal.annualMax && sal.annualMin !== sal.annualMax ? `${fmtK(sal.annualMin)} – ${fmtK(sal.annualMax)} /an` : `${fmtK(sal.annualMax ?? sal.annualMin)} /an`) : null;
    const exp = a.experience ? (a.experience.min != null ? `${a.experience.min}${a.experience.max ? `–${a.experience.max}` : '+'} ans` : a.experience.text) : null;
    const required = a.skills.filter((s) => s.required);
    const nice = a.skills.filter((s) => !s.required);
    const matched = new Set(m.matchedSkills);
    return html`<div class="stack loose kd-stagger">
      ${this.noHeader
        ? nothing
        : html`<section class="kd-surface high row nowrap" style="gap:1.5rem;align-items:center">
            <kd-score size="l" .value=${m.score}></kd-score>
            <div class="stack tight" style="min-width:0">
              <span class="kd-tag ${v.tone}">${ic(v.icon)}${v.label}</span>
              <h2 class="t-headline-s">${a.title || 'Annonce analysée'}</h2>
              <div class="muted">${[a.company, a.location].filter(Boolean).join(' · ')}</div>
              <div class="kd-hint">Confiance ${Math.round(m.confidence * 100)} % — ${m.parts.filter((p) => p.score !== null).length}/${m.parts.length} critères évalués · lecture ${a.readingMinutes} min</div>
            </div>
          </section>`}

      ${m.dealbreakers.length
        ? html`<div class="stack tight">${m.dealbreakers.map((d) => html`<div class="kd-advice danger">${ic('block')}<span>${d}</span></div>`)}</div>`
        : nothing}

      <section class="kd-surface">
        <h2 class="t-title-m">${ic('fact_check')} En un coup d’œil</h2>
        <div class="kd-facts">
          ${this.fact('contract', 'Contrat', a.contract ? `${a.contract}${a.contractMonths ? ` · ${a.contractMonths} mois` : ''}` : null)}
          ${this.fact('home_work', 'Télétravail', a.remote ? `${remoteLabel(a.remote)}${a.remoteDays && a.remote === 'hybrid' ? ` · ${a.remoteDays} j/sem.` : ''}` : null)}
          ${this.fact('payments', 'Salaire', salary)}
          ${this.fact('timeline', 'Expérience', exp)}
          ${this.fact('military_tech', 'Niveau', a.seniority)}
          ${this.fact('school', 'Formation', a.educationLevel != null ? (EDU[a.educationLevel] ?? `Bac+${a.educationLevel}`) : null)}
          ${this.fact('translate', 'Langues', a.languages.length ? a.languages.map((l) => `${l.label}${l.level ? ` (${l.level})` : ''}`).join(', ') : null)}
          ${this.fact('location_on', 'Lieu', a.location || null)}
        </div>
      </section>

      <div class="kd-grid cols-2">
        <section class="kd-surface">
          <h2 class="t-title-m">${ic('donut_large')} Détail du score</h2>
          <div class="kd-breakdown">
            ${m.parts.map((p) => {
              const pct = p.score == null ? null : Math.round(p.score * 100);
              const tone = pct == null ? 'unknown' : pct >= 70 ? '' : pct >= 45 ? 'mid' : 'low';
              return html`<div class="kd-break-row">
                <div class="head"><span>${p.label}</span><span class=${pct == null ? 'muted' : ''}>${pct == null ? 'n.c.' : `${pct} %`}</span></div>
                <div class="kd-meter ${tone}"><span style="width:${pct ?? 100}%"></span></div>
                <div class="detail">${p.detail}</div>
              </div>`;
            })}
          </div>
        </section>

        <section class="kd-surface">
          <h2 class="t-title-m">${ic('psychology')} Compétences</h2>
          ${a.skills.length
            ? html`<div class="stack">
                ${required.length
                  ? html`<div>
                      <div class="t-overline" style="margin-bottom:.5rem">Demandées</div>
                      <div class="row">
                        ${required.map((s) =>
                          matched.has(s.label)
                            ? html`<span class="kd-tag primary">${ic('check')}${s.label}</span>`
                            : html`<span class="kd-tag error">${ic('close')}${s.label}</span>`,
                        )}
                      </div>
                    </div>`
                  : nothing}
                ${nice.length
                  ? html`<div>
                      <div class="t-overline" style="margin-bottom:.5rem">Appréciées</div>
                      <div class="row">${nice.map((s) => html`<span class="kd-tag ${matched.has(s.label) ? 'secondary' : 'outline'}">${matched.has(s.label) ? ic('check') : nothing}${s.label}</span>`)}</div>
                    </div>`
                  : nothing}
                ${a.softSkills.length
                  ? html`<div>
                      <div class="t-overline" style="margin-bottom:.5rem">Savoir-être</div>
                      <div class="row">${a.softSkills.map((s) => html`<span class="kd-tag tertiary">${s.label}</span>`)}</div>
                    </div>`
                  : nothing}
              </div>`
            : html`<p class="muted">Aucune compétence reconnue. Ajoute tes compétences spécifiques dans ton profil : elles seront détectées dans les annonces.</p>`}
        </section>
      </div>

      ${m.strengths.length || m.advice.length
        ? html`<section class="kd-surface">
            <h2 class="t-title-m">${ic('tips_and_updates')} Pour ta candidature</h2>
            <div class="stack tight">
              ${m.strengths.map((s) => html`<div class="kd-advice strength">${ic('star')}<span>${s}</span></div>`)}
              ${m.advice.map((s) => html`<div class="kd-advice">${ic('lightbulb')}<span>${s}</span></div>`)}
            </div>
          </section>`
        : nothing}

      ${a.signals.length || a.keywords.length
        ? html`<section class="kd-surface">
            <h2 class="t-title-m">${ic('radar')} Signaux de l’annonce</h2>
            <div class="row">
              ${a.signals.map((s) => html`<span class="kd-tag ${s.tone === 'positive' ? 'success' : s.tone === 'warning' ? 'warning' : 'outline'}">${ic(s.tone === 'positive' ? 'add_circle' : s.tone === 'warning' ? 'report' : 'info')}${s.label}</span>`)}
            </div>
            ${a.keywords.length
              ? html`<div style="margin-top:1rem">
                  <div class="t-overline" style="margin-bottom:.5rem">Mots-clés fréquents (ATS)</div>
                  <div class="row">${a.keywords.map((k) => html`<span class="kd-tag outline">${k}</span>`)}</div>
                </div>`
              : nothing}
          </section>`
        : nothing}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kd-analysis': KdAnalysis;
  }
}
