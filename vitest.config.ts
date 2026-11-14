import { defineConfig } from 'vitest/config';

// Unit tests run in Node; they don't need the Cloudflare plugin.
export default defineConfig({
  test: { include: ['shared/**/*.test.ts', 'worker/**/*.test.ts'] },
});
