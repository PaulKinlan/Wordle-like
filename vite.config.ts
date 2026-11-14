import { execSync } from 'node:child_process';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';
import { dictionaries } from './scripts/dictionaries';
import { seo } from './scripts/seo';

/** The commit being built: Workers Builds sets WORKERS_CI_COMMIT_SHA; locally, ask git. */
function commit(): string {
  const fromCi = process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA;
  if (fromCi) return fromCi;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  plugins: [cloudflare(), seo(), dictionaries()],
  // Shown in Settings and served by /health (see shared/version.ts).
  define: {
    __APP_COMMIT__: JSON.stringify(commit()),
    __APP_BUILT__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    // Keeps the output free of inline scripts so the strict CSP holds.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
});
