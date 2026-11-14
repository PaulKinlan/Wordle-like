// Renders the PNG app icons from public/icons/icon.svg.
//   node scripts/make-icons.mjs   (needs Playwright + Chromium)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const dir = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

async function render(file, size, { maskable = false, flat = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  // Maskable icons need the artwork inside the centre 80% on a full-bleed background.
  const inner = maskable ? size * 0.78 : size;
  const art = flat ? svg.replace('rx="112"', 'rx="0"') : svg;
  await page.setContent(
    `<body style="margin:0;display:grid;place-items:center;width:${size}px;height:${size}px;background:${maskable || flat ? '#17181b' : 'transparent'}">
      <div style="width:${inner}px;height:${inner}px">${art.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`,
  );
  await page.screenshot({ path: join(dir, file), omitBackground: !maskable && !flat });
}

await render('icon-192.png', 192);
await render('icon-512.png', 512);
await render('icon-maskable-512.png', 512, { maskable: true });
await render('apple-touch-icon.png', 180, { flat: true });
await browser.close();
console.log('icons written');
