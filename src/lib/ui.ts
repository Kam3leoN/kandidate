import { html, svg, type TemplateResult } from 'lit';
import { MATERIAL_SHAPE_SVG, type MaterialShapeName } from '@k3ui/shapes/material-shapes-svg.js';
import { showSnackbar } from '@k3ui/components/feedback/snackbar-queue.js';
import { APP_STATUSES, SOURCE_LABELS, type AppStatus, type SourceId } from '../../shared/types.js';
import { ApiError } from './api.js';

/** Material Symbol (protected from page translators). */
export function ic(name: string, cls = ''): TemplateResult {
  return html`<span class="ms notranslate ${cls}" translate="no" lang="zxx" aria-hidden="true" data-k3-icon=${name}></span>`;
}

/** Icon for a k3 slot (`slot="icon"`, `slot="leading"`…). */
export function slotIc(slot: string, name: string): TemplateResult {
  return html`<span slot=${slot} class="ms notranslate" translate="no" lang="zxx" aria-hidden="true" data-k3-icon=${name}></span>`;
}

/** Material 3 Expressive shape as inline SVG (unit square path). */
export function shape(name: MaterialShapeName, cls = ''): TemplateResult {
  return html`<svg class="kd-shape ${cls}" viewBox="0 0 1 1" aria-hidden="true">${svg`<path d=${MATERIAL_SHAPE_SVG[name]}></path>`}</svg>`;
}

export function toast(message: string, opts: { icon?: string; variant?: 'inverse' | 'emphasized' | 'tonal' | 'error'; action?: string; onAction?: () => void; supportingText?: string } = {}): void {
  void showSnackbar({ message, duration: opts.action ? 'long' : 'short', queue: 'replace', dismissible: !!opts.action, ...opts });
}

export function toastError(e: unknown, fallback = 'Une erreur est survenue'): void {
  const msg = e instanceof ApiError || e instanceof Error ? e.message : fallback;
  toast(msg, { icon: 'error', variant: 'error' });
}

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

export function relDays(date: string | null | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const days = Math.round((that.getTime() - today.getTime()) / 86400_000);
  if (Math.abs(days) < 1) {
    const mins = Math.round((d.getTime() - Date.now()) / 60_000);
    if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
    return rtf.format(Math.round(mins / 60), 'hour');
  }
  if (Math.abs(days) < 7) return rtf.format(days, 'day');
  if (Math.abs(days) < 35) return rtf.format(Math.round(days / 7), 'week');
  return rtf.format(Math.round(days / 30), 'month');
}

export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(date);
  that.setHours(0, 0, 0, 0);
  return Math.round((that.getTime() - today.getTime()) / 86400_000);
}

export const fmtDate = (d: string | null | undefined, withTime = false): string =>
  d
    ? new Date(d).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        ...(new Date(d).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
        ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
      })
    : '';

export const fmtK = (v: number | null | undefined): string => (v ? `${Math.round(v / 1000)} k€` : '');

export function salaryLabel(min: number | null | undefined, max: number | null | undefined, text?: string): string {
  // Day rates / hourly / monthly amounts read better as announced than annualized.
  if (text && /(jour|tjm|\/\s?j\b|heure|horaire|mensuel|mois)/i.test(text) && text.length <= 60) return text.replace(/\s+/g, ' ');
  if (min && max && min !== max) return `${fmtK(min)} – ${fmtK(max)}`;
  if (min || max) return fmtK(min || max);
  return text ? text.replace(/\s+/g, ' ').slice(0, 48) : '';
}

export const statusMeta = (s: AppStatus): (typeof APP_STATUSES)[number] => APP_STATUSES.find((x) => x.id === s) ?? APP_STATUSES[0];
export const sourceLabel = (s: SourceId | string | null | undefined): string => (s ? (SOURCE_LABELS[s as SourceId] ?? s) : '');

export function scoreTone(score: number | null | undefined): 'great' | 'good' | 'mid' | 'low' | 'none' {
  if (score == null) return 'none';
  return score >= 80 ? 'great' : score >= 65 ? 'good' : score >= 45 ? 'mid' : 'low';
}

/** Expressive shape per score band: the better the match, the more "joyful" the shape. */
export function scoreShape(score: number | null | undefined): MaterialShapeName {
  const t = scoreTone(score);
  return t === 'great' ? 'Cookie12Sided' : t === 'good' ? 'Cookie9Sided' : t === 'mid' ? 'Pentagon' : t === 'low' ? 'Ghostish' : 'Circle';
}

export function remoteLabel(r: string | null | undefined): string {
  return r === 'full' ? '100 % télétravail' : r === 'hybrid' ? 'Hybride' : r === 'onsite' ? 'Sur site' : '';
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** Value of a k3 field from an event (k3-input / k3-change carry `{ value }`). */
export const evValue = (e: Event): string => String((e as CustomEvent<{ value?: unknown }>).detail?.value ?? (e.target as HTMLInputElement)?.value ?? '');

export async function copyText(text: string, label = 'Copié dans le presse-papiers'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, { icon: 'content_copy' });
  } catch {
    toast('Copie impossible : sélectionne le texte manuellement', { icon: 'error' });
  }
}

/** Await the next frame (lets k3 elements upgrade before calling their methods). */
export const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/** Open a k3-dialog by id inside a root, once it is defined. */
type DialogEl = HTMLElement & { show?: () => Promise<boolean>; hide?: () => Promise<boolean> };

/** k3-dialog moves itself to <body> while open (layer portal): look in the view, then in the document. */
function findDialog(root: ParentNode, id: string): DialogEl | null {
  return root.querySelector<DialogEl>(`#${id}`) ?? (document.getElementById(id) as DialogEl | null);
}

export async function openDialog(root: ParentNode, id: string): Promise<HTMLElement | null> {
  const el = findDialog(root, id);
  if (!el) return null;
  await customElements.whenDefined('k3-dialog');
  await el.show?.();
  return el;
}

export async function closeDialog(root: ParentNode, id: string): Promise<void> {
  await findDialog(root, id)?.hide?.();
}
