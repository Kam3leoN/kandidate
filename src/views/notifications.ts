import { html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { AppNotification, NotificationKind } from '../../shared/types.js';
import { LightElement } from '../components/base.js';
import { emptyState, loading } from '../components/offer-card.js';
import { del, get, post } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { store } from '../lib/store.js';
import { ic, relDays, shape, slotIc, toastError } from '../lib/ui.js';

const KIND: Record<NotificationKind, { icon: string; tone: string; shape: Parameters<typeof shape>[0] }> = {
  offer_match: { icon: 'local_fire_department', tone: 'primary', shape: 'Cookie9Sided' },
  followup_due: { icon: 'forward_to_inbox', tone: 'tertiary', shape: 'Clover4Leaf' },
  interview_soon: { icon: 'groups', tone: 'secondary', shape: 'Gem' },
  import: { icon: 'mark_email_read', tone: 'secondary', shape: 'Sunny' },
  digest: { icon: 'mail', tone: 'secondary', shape: 'Pill' },
  system: { icon: 'info', tone: 'secondary', shape: 'Circle' },
};

function bucket(d: string): string {
  const days = (Date.now() - new Date(d).getTime()) / 86400_000;
  if (new Date(d).toDateString() === new Date().toDateString()) return 'Aujourd’hui';
  if (days < 7) return 'Cette semaine';
  return 'Plus ancien';
}

@customElement('kd-notifications')
export class KdNotifications extends LightElement {
  @state() private items: AppNotification[] | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const r = await get<{ items: AppNotification[]; unread: number }>('/notifications?limit=100');
      this.items = r.items;
      store.set({ unread: r.unread });
    } catch (e) {
      toastError(e);
    }
  }

  private async open(n: AppNotification): Promise<void> {
    if (!n.readAt) await post('/notifications/read', { ids: [n.id] }).catch(() => undefined);
    void store.refreshUnread();
    if (n.url) navigate(n.url);
  }

  protected override render(): unknown {
    const items = this.items;
    const groups = new Map<string, AppNotification[]>();
    for (const n of items ?? []) groups.set(bucket(n.createdAt), [...(groups.get(bucket(n.createdAt)) ?? []), n]);
    return html`<div class="kd-page" style="max-width:56rem">
      <header class="kd-page-head">
        <div>
          <div class="t-overline">Centre d’alertes</div>
          <h1 class="t-display">Notifications</h1>
        </div>
        <div class="actions">
          <k3-button variant="tonal" ?disabled=${!items?.some((n) => !n.readAt)} @click=${async () => {
            await post('/notifications/read', { ids: 'all' });
            await this.load();
          }}>${slotIc('icon', 'done_all')}Tout marquer comme lu</k3-button>
          <k3-icon-button variant="standard" label="Réglages des notifications" @click=${() => navigate('/settings')}>${ic('tune')}</k3-icon-button>
        </div>
      </header>
      ${items === null
        ? loading()
        : items.length
          ? [...groups.entries()].map(
              ([label, list]) => html`<h2 class="t-overline" style="margin:1.25rem 0 .5rem">${label}</h2>
                <div class="kd-list kd-stagger">
                  ${list.map((n) => {
                    const k = KIND[n.kind] ?? KIND.system;
                    return html`<div class="kd-item ${n.readAt ? '' : 'unread'}" style="align-items:flex-start" @click=${(e: Event) => {
                      if ((e.target as HTMLElement).closest('k3-icon-button')) return;
                      void this.open(n);
                    }}>
                      <span class="kd-shape-icon" style="--kd-shape-bg:var(--k3-sys-color-${k.tone}-container);--kd-shape-fg:var(--k3-sys-color-on-${k.tone}-container);width:2.75rem;height:2.75rem">${shape(k.shape)}${ic(k.icon)}</span>
                      <span class="body">
                        <div class="title" style="white-space:normal">${n.title}</div>
                        ${n.body ? html`<div class="sub" style="white-space:pre-line">${n.body}</div>` : ''}
                        <div class="kd-hint" style="margin-top:.25rem">${relDays(n.createdAt)}</div>
                      </span>
                      <k3-icon-button variant="standard" size="sm" label="Supprimer" @click=${async () => {
                        await del(`/notifications/${n.id}`);
                        await this.load();
                      }}>${ic('close')}</k3-icon-button>
                    </div>`;
                  })}
                </div>`,
            )
          : emptyState('notifications_none', 'Rien de neuf', 'Les nouvelles offres qui te correspondent, les relances à faire et les entretiens à venir s’afficheront ici.')}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kd-notifications': KdNotifications;
  }
}
