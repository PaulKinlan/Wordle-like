import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [cloudflare()],
  build: {
    // Keeps the output free of inline scripts so the strict CSP holds.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
});
