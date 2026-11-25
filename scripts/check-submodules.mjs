// Warn early when the k3ui / k3ux submodules were not fetched (git clone without --recurse-submodules).
import { existsSync } from 'node:fs';
const missing = ['vendor/k3ui/src/lazy.ts', 'vendor/k3ux/src/components/charts/chart.ts'].filter((p) => !existsSync(p));
if (missing.length) {
  console.warn('\n[kandidate] Submodules manquants → lance : git submodule update --init --recursive\n');
}
