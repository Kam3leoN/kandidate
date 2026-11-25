import { K3UI } from 'k3ui';
import type { Settings } from '../../shared/types.js';

/** Apply the Material You (M3 Expressive) scheme from the seed + cache it for the next pre-paint. */
export function applyTheme(s: Pick<Settings, 'seedColor' | 'themeMode'>): void {
  K3UI.theme.apply({
    seed: s.seedColor,
    mode: s.themeMode,
    variant: 'expressive',
    motion: 'expressive',
    specVersion: '2025',
    contrast: 'auto',
  });
  requestAnimationFrame(() => {
    const st = document.documentElement.style;
    const vars: Record<string, string> = {};
    for (let i = 0; i < st.length; i++) {
      const k = st[i];
      if (k.startsWith('--k3-sys-color-')) vars[k] = st.getPropertyValue(k);
    }
    const surface = vars['--k3-sys-color-surface'];
    if (surface) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', surface.trim());
    document.documentElement.dataset.kdDark = document.documentElement.dataset.k3ColorMode === 'dark' ? '1' : '0';
    try {
      localStorage.setItem('kd.theme', JSON.stringify({ mode: s.themeMode, seed: s.seedColor, vars }));
    } catch {
      /* private mode */
    }
  });
}

export function cachedTheme(): Pick<Settings, 'seedColor' | 'themeMode'> {
  try {
    const t = JSON.parse(localStorage.getItem('kd.theme') ?? 'null') as { mode?: Settings['themeMode']; seed?: string } | null;
    return { seedColor: t?.seed ?? '#6750A4', themeMode: t?.mode ?? 'system' };
  } catch {
    return { seedColor: '#6750A4', themeMode: 'system' };
  }
}
