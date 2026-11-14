import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests run in Node; they don't need the Cloudflare plugin.
export default defineConfig({
  test: { include: ['shared/**/*.test.ts', 'worker/**/*.test.ts', 'src/**/*.test.ts'] },
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(new URL('./worker/test/cloudflare-workers-stub.ts', import.meta.url)),
    },
  },
});
