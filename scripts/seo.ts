// Search and social: per-language landing pages (/es/, /fr/, ...), hreflang
// links, JSON-LD structured data, robots.txt and sitemap.xml. A Vite plugin,
// so the pages are plain static files with the right <head> for crawlers and
// link previews, and the strict CSP still holds (JSON-LD is data, not script).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export const SITE = 'https://letterle.app';

interface Page {
  /** BCP 47 code, also the path: /es/ */
  code: string;
  title: string;
  description: string;
  /** og:locale */
  locale: string;
}

/** English is the root page; the rest get their own path. */
export const PAGES: Page[] = [
  {
    code: 'en',
    title: 'Letterle: a daily word game',
    description: 'Guess the five-letter word in six tries. A new word every day, unlimited play and races with friends. No ads, no tracking.',
    locale: 'en_GB',
  },
  {
    code: 'es',
    title: 'Letterle: un juego de palabras diario',
    description: 'Adivina la palabra de cinco letras en seis intentos. Una palabra nueva cada día, partidas ilimitadas y carreras con amigos. Sin anuncios.',
    locale: 'es_ES',
  },
  {
    code: 'fr',
    title: 'Letterle : un jeu de mots quotidien',
    description: 'Devinez le mot de cinq lettres en six essais. Un nouveau mot chaque jour, des parties illimitées et des courses entre amis. Sans publicité.',
    locale: 'fr_FR',
  },
  {
    code: 'de',
    title: 'Letterle: ein tägliches Wortspiel',
    description: 'Errate das Wort mit fünf Buchstaben in sechs Versuchen. Jeden Tag ein neues Wort, unbegrenzt spielen und Rennen gegen Freunde. Ohne Werbung.',
    locale: 'de_DE',
  },
  {
    code: 'it',
    title: 'Letterle: un gioco di parole quotidiano',
    description: 'Indovina la parola di cinque lettere in sei tentativi. Una parola nuova ogni giorno, partite illimitate e sfide con gli amici. Senza pubblicità.',
    locale: 'it_IT',
  },
  {
    code: 'pt',
    title: 'Letterle: um jogo de palavras diário',
    description: 'Adivinhe a palavra de cinco letras em seis tentativas. Uma palavra nova todos os dias, jogo ilimitado e corridas com amigos. Sem anúncios.',
    locale: 'pt_PT',
  },
  {
    code: 'nl',
    title: 'Letterle: een dagelijks woordspel',
    description: 'Raad het woord van vijf letters in zes pogingen. Elke dag een nieuw woord, onbeperkt spelen en races met vrienden. Zonder advertenties.',
    locale: 'nl_NL',
  },
];

export const pageUrl = (code: string) => (code === 'en' ? `${SITE}/` : `${SITE}/${code}/`);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function jsonLd(page: Page): string {
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE}/#website`,
        url: `${SITE}/`,
        name: 'Letterle',
        description: PAGES[0].description,
        inLanguage: PAGES.map((p) => p.code),
      },
      {
        '@type': ['VideoGame', 'WebApplication'],
        '@id': `${pageUrl(page.code)}#game`,
        name: 'Letterle',
        url: pageUrl(page.code),
        description: page.description,
        inLanguage: page.code,
        image: `${SITE}/og.png`,
        screenshot: `${SITE}/screenshots/game-narrow.png`,
        genre: ['Word game', 'Puzzle'],
        gamePlatform: 'Web browser',
        applicationCategory: 'GameApplication',
        operatingSystem: 'Any',
        playMode: ['SinglePlayer', 'MultiPlayer'],
        numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 8 },
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'GBP' },
        isPartOf: { '@id': `${SITE}/#website` },
      },
    ],
  };
  // "<" can't appear in JSON-LD text anyway, but escape it so nothing can close the tag.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

const alternates = () =>
  [...PAGES.map((p) => `<link rel="alternate" hreflang="${p.code}" href="${pageUrl(p.code)}" />`), `<link rel="alternate" hreflang="x-default" href="${SITE}/" />`].join(
    '\n    ',
  );

/** The <head> bits that differ per language, applied to the built index.html. */
export function localise(html: string, page: Page): string {
  const url = pageUrl(page.code);
  const others = PAGES.filter((p) => p.code !== page.code).map((p) => `<meta property="og:locale:alternate" content="${p.locale}" />`);
  return html
    .replace(/<html lang="[^"]*"/, `<html lang="${page.code}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${esc(page.description)}"`)
    .replace(/<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${url}"`)
    .replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${esc(page.title)}"`)
    .replace(/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${esc(page.description)}"`)
    .replace(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${url}"`)
    .replace(
      '</head>',
      `  <meta property="og:locale" content="${page.locale}" />\n    ${others.join('\n    ')}\n    ${alternates()}\n    ${jsonLd(page)}\n  </head>`,
    );
}

export function sitemap(today = new Date().toISOString().slice(0, 10)): string {
  const links = PAGES.map((p) => `    <xhtml:link rel="alternate" hreflang="${p.code}" href="${pageUrl(p.code)}" />`).join('\n');
  const urls = PAGES.map(
    (p) => `  <url>
    <loc>${pageUrl(p.code)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
${links}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/" />
  </url>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
}

export const ROBOTS = `# Letterle: everything is welcome except the private dashboard and the API.
User-agent: *
Allow: /
Disallow: /api/
Disallow: /dashboard/

Sitemap: ${SITE}/sitemap.xml
`;

/** Vite plugin: writes /<lang>/index.html, sitemap.xml and robots.txt after the client build. */
export function seo(): Plugin {
  let outDir = '';
  let template = ''; // the built index.html before the English additions
  return {
    name: 'letterle-seo',
    // The dev server and the root page get the English head too.
    transformIndexHtml: {
      order: 'post',
      handler: (html) => {
        template = html;
        return localise(html, PAGES[0]);
      },
    },
    configResolved(config) {
      outDir = config.environments?.client?.build?.outDir ?? config.build.outDir;
    },
    writeBundle: {
      sequential: true,
      handler(options) {
        const dir = options.dir ?? outDir;
        if (!template || !existsSync(join(dir, 'index.html'))) return; // not the client build (e.g. the Worker)
        for (const page of PAGES.slice(1)) {
          mkdirSync(join(dir, page.code), { recursive: true });
          writeFileSync(join(dir, page.code, 'index.html'), localise(template, page));
        }
        writeFileSync(join(dir, 'sitemap.xml'), sitemap());
        writeFileSync(join(dir, 'robots.txt'), ROBOTS);
      },
    },
  };
}
