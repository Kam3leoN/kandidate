/**
 * KandiDate — boot: k3ui (lazy, components: 'auto'), Material You theme, PWA, app shell.
 */
import '@k3ui/fonts/fonts-ui.css';
import { K3UI } from 'k3ui';
import { watchIconLigatures } from '@k3ui/icons/ligature.js';
import './styles/app.css';
import { cachedTheme, applyTheme } from './lib/theme.js';
import './app.js';

async function boot(): Promise<void> {
  const t = cachedTheme();
  await K3UI.init({
    locale: 'fr-FR',
    theme: { seed: t.seedColor, mode: t.themeMode, variant: 'expressive', motion: 'expressive', specVersion: '2025', contrast: 'auto' },
    components: 'auto',
    motion: { reduce: 'system' },
    interaction: { ripple: true },
    overlays: { scrollLock: true },
    haptic: true,
    missingComponents: 'console',
  });
  applyTheme(t);
  watchIconLigatures(document);
  document.documentElement.removeAttribute('data-k3-booting');

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[sw]', e));
  }
  // Notification click while the app is open → route change from the service worker.
  navigator.serviceWorker?.addEventListener('message', (e: MessageEvent<{ type?: string; url?: string }>) => {
    if (e.data?.type === 'navigate' && e.data.url) location.hash = e.data.url.replace(/^\/?#?/, '#');
  });
}

void boot();
