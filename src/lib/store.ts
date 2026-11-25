import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { DEFAULT_SETTINGS, EMPTY_PROFILE, type Profile, type Settings, type SourceStatus } from '../../shared/types.js';
import { get, put } from './api.js';

export interface SystemInfo {
  db: 'neon' | 'pglite';
  authRequired: boolean;
  sources: SourceStatus[];
  push: { configured: boolean; publicKey: string | null };
  email: { configured: boolean; from: string | null };
  inbound: { resend: boolean; generic: boolean; address: string | null };
  cron: { secret: boolean; runs: Array<{ id: number; trigger: string; started_at: string; finished_at: string | null; stats: Record<string, unknown>; error: string | null }> };
}

interface State {
  profile: Profile;
  settings: Settings;
  system: SystemInfo | null;
  unread: number;
  authenticated: boolean;
  authRequired: boolean;
  ready: boolean;
}

class Store extends EventTarget {
  state: State = {
    profile: EMPTY_PROFILE,
    settings: DEFAULT_SETTINGS,
    system: null,
    unread: 0,
    authenticated: false,
    authRequired: false,
    ready: false,
  };

  set(patch: Partial<State>): void {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new Event('change'));
  }

  async load(): Promise<void> {
    const [profile, settings, notifs] = await Promise.all([
      get<Profile>('/profile'),
      get<Settings>('/settings'),
      get<{ unread: number }>('/notifications?unread=1&limit=1'),
    ]);
    this.set({ profile, settings, unread: notifs.unread, ready: true });
    void this.refreshSystem();
  }

  async refreshSystem(): Promise<void> {
    this.set({ system: await get<SystemInfo>('/system') });
  }

  async refreshUnread(): Promise<void> {
    const n = await get<{ unread: number }>('/notifications?unread=1&limit=1');
    if (n.unread !== this.state.unread) this.set({ unread: n.unread });
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const settings = await put<Settings>('/settings', { ...this.state.settings, ...patch });
    this.set({ settings });
    return settings;
  }
}

export const store = new Store();

/** Lit controller: re-render the host whenever the store changes. */
export class StoreController implements ReactiveController {
  private onChange = (): void => this.host.requestUpdate();
  constructor(private host: ReactiveControllerHost) {
    host.addController(this);
  }
  hostConnected(): void {
    store.addEventListener('change', this.onChange);
  }
  hostDisconnected(): void {
    store.removeEventListener('change', this.onChange);
  }
  get state(): State {
    return store.state;
  }
}
