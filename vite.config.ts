import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig, type Plugin } from 'vite';
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

const built = new Date().toISOString();

/**
 * Writes /version.json beside the page. The deploy (`wrangler deploy`, which
 * runs this build first) bundles the Worker itself, without the values defined
 * below, so the Worker reads its version from this file (worker/telemetry.ts).
 */
function versionFile(): Plugin {
  return {
    name: 'letterle-version',
    writeBundle(options) {
      const dir = options.dir;
      if (!dir || !existsSync(join(dir, 'index.html'))) return; // not the client build
      writeFileSync(join(dir, 'version.json'), JSON.stringify({ commit: commit(), built }));
    },
  };
}

export default defineConfig({
  plugins: [cloudflare(), seo(), dictionaries(), versionFile()],
  // Shown in Settings and served by /health (see shared/version.ts).
  define: {
    __APP_COMMIT__: JSON.stringify(commit()),
    __APP_BUILT__: JSON.stringify(built),
  },
  build: {
    // Keeps the output free of inline scripts so the strict CSP holds.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
});
