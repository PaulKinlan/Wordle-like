// Link previews for shared results and race invites, made by the Worker.
//
//   GET /s/:lang/:game/:grid   a shared result: the game page, with a preview of the score
//   GET /r/:code               a race invite: the game page, with a "join my race" preview
//   GET /og/s/... .png, /og/r/:code.png   the preview images (1200×630 PNG)
//
// :game is d<number> (daily) or u (unlimited), with h after it for hard mode.
// :grid is the colours only, one digit per tile (0 absent, 1 present, 2
// correct), rows split by "-". No letters, so a preview never spoils the word.
//
// The images are drawn here without any image library: a small raster with
// text from pre-rendered Inter glyphs (og-font.ts) and a PNG encoder that uses
// the platform's CompressionStream.
import { getLanguage, type LanguageInfo } from '../shared/languages';
import { ROOM_CODE } from '../shared/race';
import { body as BODY, line as LINE, score as SCORE, title as TITLE, type OgFace } from './og-font';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
/** Bump when the image design changes, so caches fetch the new one. */
const OG_VERSION = 1;

// ---------------------------------------------------------------- parsing

export interface SharedResult {
  lang: LanguageInfo;
  daily: number | null;
  hard: boolean;
  rows: number[][];
  won: boolean;
}

export function parseResult(lang: string, game: string, grid: string): SharedResult | null {
  const info = getLanguage(lang);
  const g = /^(d(\d{1,5})|u)(h?)$/.exec(game);
  if (!info || !g) return null;
  const rows = grid.split('-').map((r) => [...r].map(Number));
  if (!rows.length || rows.length > info.maxGuesses) return null;
  if (!rows.every((r) => r.length === info.wordLength && r.every((m) => m === 0 || m === 1 || m === 2))) return null;
  const solved = rows.map((r) => r.every((m) => m === 2));
  // Only the last row can be the solved one.
  if (solved.slice(0, -1).some(Boolean)) return null;
  const won = solved.at(-1)!;
  if (!won && rows.length !== info.maxGuesses) return null;
  return { lang: info, daily: g[2] ? Number(g[2]) : null, hard: g[3] === 'h', rows, won };
}

// ---------------------------------------------------------------- words

const WORDS: Record<string, Record<string, string>> = {
  en: {
    daily: 'Daily #{n}',
    unlimited: 'Unlimited',
    hard: 'hard mode',
    beat: 'Can you beat it?',
    lost: 'Not this time. Can you get it?',
    play: 'Play at {host}',
    raceTitle: 'Join my race',
    raceBody: 'Same word for everyone. Fastest to solve wins.',
    raceCode: 'Race code',
    titleResult: 'Letterle {which}: {score}',
    descResult: 'Same word, no letters given away. Can you beat it?',
    descRace: 'Race code {code}. Same word for everyone, fastest to solve wins.',
  },
  es: {
    daily: 'Diario n.º {n}',
    unlimited: 'Ilimitado',
    hard: 'modo difícil',
    beat: '¿Puedes superarlo?',
    lost: 'Esta vez no. ¿Lo sacas tú?',
    play: 'Juega en {host}',
    raceTitle: 'Únete a mi carrera',
    raceBody: 'La misma palabra para todos. Gana quien la resuelva antes.',
    raceCode: 'Código',
    titleResult: 'Letterle {which}: {score}',
    descResult: 'La misma palabra, sin desvelar letras. ¿Puedes superarlo?',
    descRace: 'Código {code}. La misma palabra para todos; gana el más rápido.',
  },
  fr: {
    daily: 'Mot du jour n° {n}',
    unlimited: 'Illimité',
    hard: 'mode difficile',
    beat: 'Saurez-vous faire mieux ?',
    lost: 'Pas cette fois. À vous de jouer ?',
    play: 'Jouez sur {host}',
    raceTitle: 'Rejoignez ma course',
    raceBody: 'Le même mot pour tous. Le plus rapide gagne.',
    raceCode: 'Code',
    titleResult: 'Letterle {which} : {score}',
    descResult: 'Le même mot, sans dévoiler de lettres. Saurez-vous faire mieux ?',
    descRace: 'Code {code}. Le même mot pour tous, le plus rapide gagne.',
  },
  de: {
    daily: 'Tageswort Nr. {n}',
    unlimited: 'Unbegrenzt',
    hard: 'schwer',
    beat: 'Schaffst du es besser?',
    lost: 'Diesmal nicht. Schaffst du es?',
    play: 'Spiel auf {host}',
    raceTitle: 'Mach mit bei meinem Rennen',
    raceBody: 'Dasselbe Wort für alle. Wer es zuerst löst, gewinnt.',
    raceCode: 'Code',
    titleResult: 'Letterle {which}: {score}',
    descResult: 'Dasselbe Wort, ohne Buchstaben zu verraten. Schaffst du es besser?',
    descRace: 'Code {code}. Dasselbe Wort für alle, wer zuerst löst, gewinnt.',
  },
  it: {
    daily: 'Parola del giorno n. {n}',
    unlimited: 'Illimitato',
    hard: 'modalità difficile',
    beat: 'Riesci a fare meglio?',
    lost: 'Non stavolta. Ci riesci tu?',
    play: 'Gioca su {host}',
    raceTitle: 'Unisciti alla mia sfida',
    raceBody: 'La stessa parola per tutti. Vince chi la indovina prima.',
    raceCode: 'Codice',
    titleResult: 'Letterle {which}: {score}',
    descResult: 'La stessa parola, senza svelare lettere. Riesci a fare meglio?',
    descRace: 'Codice {code}. La stessa parola per tutti, vince il più veloce.',
  },
  pt: {
    daily: 'Diário n.º {n}',
    unlimited: 'Ilimitado',
    hard: 'modo difícil',
    beat: 'Consegues fazer melhor?',
    lost: 'Desta vez não. Consegues tu?',
    play: 'Joga em {host}',
    raceTitle: 'Entra na minha corrida',
    raceBody: 'A mesma palavra para todos. Ganha quem acertar primeiro.',
    raceCode: 'Código',
    titleResult: 'Letterle {which}: {score}',
    descResult: 'A mesma palavra, sem revelar letras. Consegues fazer melhor?',
    descRace: 'Código {code}. A mesma palavra para todos, ganha o mais rápido.',
  },
  nl: {
    daily: 'Dagwoord nr. {n}',
    unlimited: 'Onbeperkt',
    hard: 'moeilijk',
    beat: 'Kun jij het beter?',
    lost: 'Deze keer niet. Lukt het jou?',
    play: 'Speel op {host}',
    raceTitle: 'Doe mee aan mijn race',
    raceBody: 'Hetzelfde woord voor iedereen. Wie het eerst raadt, wint.',
    raceCode: 'Code',
    titleResult: 'Letterle {which}: {score}',
    descResult: 'Hetzelfde woord, zonder letters te verraden. Kun jij het beter?',
    descRace: 'Code {code}. Hetzelfde woord voor iedereen, de snelste wint.',
  },
};

function say(lang: string, key: string, vars: Record<string, string | number> = {}) {
  const text = WORDS[lang]?.[key] ?? WORDS.en[key];
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

const which = (r: SharedResult) => {
  const base = r.daily !== null ? say(r.lang.code, 'daily', { n: r.daily }) : say(r.lang.code, 'unlimited');
  return r.hard ? `${base} (${say(r.lang.code, 'hard')})` : base;
};
const scoreText = (r: SharedResult) => `${r.won ? r.rows.length : 'X'}/${r.lang.maxGuesses}`;

// ---------------------------------------------------------------- drawing

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const C = {
  bg: hex('#f6f6f3'),
  text: hex('#17181b'),
  muted: hex('#6b6f78'),
  border: hex('#d3d6da'),
  correct: hex('#2f9e74'),
  present: hex('#d9a21b'),
  absent: hex('#7d828c'),
  white: hex('#ffffff'),
};

class Raster {
  readonly px: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
    bg: RGB,
  ) {
    this.px = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.px.set(bg, i * 3);
  }

  /** Blends `color` into one pixel with coverage a (0..1). */
  blend(x: number, y: number, color: RGB, a: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 3;
    if (a >= 1) {
      this.px[i] = color[0];
      this.px[i + 1] = color[1];
      this.px[i + 2] = color[2];
      return;
    }
    for (let c = 0; c < 3; c++) this.px[i + c] = Math.round(this.px[i + c] * (1 - a) + color[c] * a);
  }

  /** A filled rectangle with rounded, anti-aliased corners. */
  roundRect(x: number, y: number, w: number, h: number, r: number, color: RGB) {
    for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
      for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
        const cx = px + 0.5;
        const cy = py + 0.5;
        // Distance outside the rounded shape, in pixels.
        const dx = Math.max(x + r - cx, 0, cx - (x + w - r));
        const dy = Math.max(y + r - cy, 0, cy - (y + h - r));
        const d = Math.hypot(dx, dy) - r;
        this.blend(px, py, color, Math.min(1, Math.max(0, 0.5 - d)));
      }
    }
  }
}

const atlases = new Map<OgFace, Uint8Array>();

async function inflate(b64: string): Promise<Uint8Array> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function loadFaces() {
  for (const f of [SCORE, TITLE, LINE, BODY]) if (!atlases.has(f)) atlases.set(f, await inflate(f.atlas));
}

/** Width of `text` in `face`, at `scale`. Characters the font doesn't have are skipped. */
export function measure(face: OgFace, text: string, scale = 1) {
  let w = 0;
  for (const ch of text) w += (face.glyphs[ch]?.[4] ?? 0) * scale;
  return w;
}

/** Draws text with its baseline at y, shrunk by `scale` (at most 1) when it needs to fit. */
function text(img: Raster, face: OgFace, str: string, x: number, y: number, color: RGB, scale = 1) {
  const atlas = atlases.get(face)!;
  let pen = x;
  for (const ch of str) {
    const g = face.glyphs[ch];
    if (!g) continue;
    const [gx, gy, gw, left] = g;
    const ox = pen + left * scale;
    const oy = y - face.ascent * scale;
    const w = Math.ceil(gw * scale);
    const h = Math.ceil(face.height * scale);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let a: number;
        if (scale === 1) a = atlas[(gy + j) * face.width + gx + i];
        else {
          // Supersample the source area this output pixel covers (4×4 points).
          let sum = 0;
          for (let v = 0; v < 4; v++) {
            for (let u = 0; u < 4; u++) {
              const sx = Math.min(gw - 1, Math.floor((i + (u + 0.5) / 4) / scale));
              const sy = Math.min(face.height - 1, Math.floor((j + (v + 0.5) / 4) / scale));
              sum += atlas[(gy + sy) * face.width + gx + sx];
            }
          }
          a = sum / 16;
        }
        if (a) img.blend(Math.round(ox) + i, Math.round(oy) + j, color, a / 255);
      }
    }
    pen += g[4] * scale;
  }
  return pen - x;
}

/** Shrinks text to fit `max` pixels wide. */
const fit = (face: OgFace, str: string, max: number) => Math.min(1, max / Math.max(1, measure(face, str)));

/** The "Letterle" wordmark, small, top left. */
function brand(img: Raster) {
  const letters = [...'LETTERLE'];
  const marks: RGB[] = [C.correct, C.present, C.absent, C.correct, C.correct, C.present, C.absent, C.correct];
  const size = 46;
  letters.forEach((ch, i) => {
    const x = 72 + i * (size + 6);
    img.roundRect(x, 64, size, size, 8, marks[i]);
    const s = 0.5;
    const w = measure(TITLE, ch, s);
    text(img, TITLE, ch, x + (size - w) / 2, 64 + size / 2 + 12, C.white, s);
  });
}

function pill(img: Raster, label: string, x: number, y: number) {
  const s = fit(BODY, label, 520);
  const w = measure(BODY, label, s) + 48;
  img.roundRect(x, y, w, 64, 32, C.text);
  text(img, BODY, label, x + 24, y + 45, C.bg, s);
}

/** Tiles laid out in the right-hand area, centred. */
function grid(img: Raster, rows: number[][], cols: number, total: number) {
  const area = { x: 700, y: 64, w: 440, h: 502 };
  const gap = 10;
  const size = Math.floor(Math.min((area.w - gap * (cols - 1)) / cols, (area.h - gap * (total - 1)) / total));
  const gw = cols * size + (cols - 1) * gap;
  const gh = total * size + (total - 1) * gap;
  const x0 = area.x + (area.w - gw) / 2;
  const y0 = area.y + (area.h - gh) / 2;
  const colour = [C.absent, C.present, C.correct];
  for (let r = 0; r < total; r++) {
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * (size + gap);
      const y = y0 + r * (size + gap);
      const mark = rows[r]?.[c];
      if (mark === undefined) {
        img.roundRect(x, y, size, size, 8, C.border);
        img.roundRect(x + 3, y + 3, size - 6, size - 6, 6, C.bg);
      } else img.roundRect(x, y, size, size, 8, colour[mark]);
    }
  }
}

export async function resultImage(r: SharedResult, host: string): Promise<Uint8Array> {
  await loadFaces();
  const img = new Raster(OG_WIDTH, OG_HEIGHT, C.bg);
  const lang = r.lang.code;
  brand(img);
  const sub = which(r);
  text(img, BODY, sub, 72, 172, C.muted, fit(BODY, sub, 580));
  const score = scoreText(r);
  text(img, SCORE, score, 64, 400, r.won ? C.correct : C.muted, fit(SCORE, score, 600));
  const line = r.won ? say(lang, 'beat') : say(lang, 'lost');
  text(img, LINE, line, 72, 480, C.text, fit(LINE, line, 600));
  pill(img, say(lang, 'play', { host }), 72, 520);
  grid(img, r.rows, r.lang.wordLength, r.lang.maxGuesses);
  return png(img);
}

export async function raceImage(code: string, lang: string, host: string): Promise<Uint8Array> {
  await loadFaces();
  const img = new Raster(OG_WIDTH, OG_HEIGHT, C.bg);
  brand(img);
  const head = say(lang, 'raceTitle');
  text(img, TITLE, head, 72, 236, C.text, fit(TITLE, head, 1056));
  const bodyText = say(lang, 'raceBody');
  text(img, BODY, bodyText, 72, 300, C.muted, fit(BODY, bodyText, 1056));
  // The code as tiles.
  const size = 120;
  const gap = 14;
  [...code].forEach((ch, i) => {
    const x = 72 + i * (size + gap);
    img.roundRect(x, 350, size, size, 14, i % 2 ? C.present : C.correct);
    const w = measure(TITLE, ch);
    text(img, TITLE, ch, x + (size - w) / 2, 350 + size / 2 + 30, C.white, 1);
  });
  pill(img, `${host}/r/${code}`, 72, 516);
  return png(img);
}

// ---------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]) {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const t = new TextEncoder().encode(type);
  out.set(t, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32([t, data]));
  return out;
}

async function png(img: Raster): Promise<Uint8Array> {
  const { w, h, px } = img;
  // Each row starts with filter type 0 (none).
  const raw = new Uint8Array(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const zipped = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zipped), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---------------------------------------------------------------- routes

interface Meta {
  title: string;
  description: string;
  image: string;
  alt: string;
  url: string;
  lang: string;
}

/** The game page with the preview tags swapped in. */
async function page(assets: Fetcher, request: Request, meta: Meta): Promise<Response> {
  const base = await assets.fetch(new Request(new URL('/', request.url), { headers: request.headers }));
  if (!base.ok) return base;
  const content = (value: string) => ({
    element(el: Element) {
      el.setAttribute('content', value);
    },
  });
  const res = new HTMLRewriter()
    .on('html', {
      element(el) {
        el.setAttribute('lang', meta.lang);
      },
    })
    .on('title', {
      element(el) {
        el.setInnerContent(meta.title);
      },
    })
    .on('meta[name="description"]', content(meta.description))
    .on('meta[property="og:title"]', content(meta.title))
    .on('meta[property="og:description"]', content(meta.description))
    .on('meta[property="og:url"]', content(meta.url))
    .on('meta[property="og:image"]', content(meta.image))
    .on('meta[property="og:image:alt"]', content(meta.alt))
    .on('meta[property^="og:locale"]', {
      element(el) {
        el.remove();
      },
    })
    .on('head', {
      element(el) {
        // A shared link is a copy of the home page: keep it out of search results.
        el.append('<meta name="robots" content="noindex" />', { html: true });
      },
    })
    .transform(base);
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-cache'); // like index.html: it names this deploy's scripts
  return new Response(res.body, { status: 200, headers });
}

function imageResponse(bytes: Uint8Array) {
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/png',
      // The URL says everything that's in the picture, so it never changes.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Handles /s/..., /r/... and /og/...; null for anything else. */
export async function handlePreview(request: Request, assets: Fetcher, ctx: ExecutionContext): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const host = url.host;
  let m: RegExpExecArray | null;

  if ((m = /^\/s\/([a-z]{2,3})\/([a-z0-9]+)\/([0-2-]+)\/?$/.exec(url.pathname))) {
    const r = parseResult(m[1], m[2], m[3]);
    if (!r) return null;
    const score = scoreText(r);
    return page(assets, request, {
      title: say(r.lang.code, 'titleResult', { which: which(r), score }),
      description: say(r.lang.code, 'descResult'),
      image: `${url.origin}/og/s/${m[1]}/${m[2]}/${m[3]}.png?v=${OG_VERSION}`,
      alt: `${which(r)}: ${score}`,
      url: url.href,
      lang: r.lang.code,
    });
  }

  if ((m = /^\/r\/([A-Za-z0-9]{6})\/?$/.exec(url.pathname))) {
    const code = m[1].toUpperCase();
    if (!ROOM_CODE.test(code)) return null;
    const lang = url.searchParams.get('lang') ?? 'en';
    return page(assets, request, {
      title: `Letterle: ${say(lang, 'raceTitle')}`,
      description: say(lang, 'descRace', { code }),
      image: `${url.origin}/og/r/${code}.png?v=${OG_VERSION}${lang !== 'en' && WORDS[lang] ? `&lang=${lang}` : ''}`,
      alt: `${say(lang, 'raceCode')} ${code}`,
      url: url.href,
      lang,
    });
  }

  if (url.pathname.startsWith('/og/')) {
    const cache = (caches as unknown as { default: Cache }).default;
    const hit = await cache.match(request);
    if (hit) return hit;
    let res: Response | null = null;
    if ((m = /^\/og\/s\/([a-z]{2,3})\/([a-z0-9]+)\/([0-2-]+)\.png$/.exec(url.pathname))) {
      const r = parseResult(m[1], m[2], m[3]);
      if (r) res = imageResponse(await resultImage(r, host));
    } else if ((m = /^\/og\/r\/([A-Z0-9]{6})\.png$/.exec(url.pathname)) && ROOM_CODE.test(m[1])) {
      const lang = url.searchParams.get('lang') ?? 'en';
      res = imageResponse(await raceImage(m[1], WORDS[lang] ? lang : 'en', host));
    }
    if (!res) return new Response('Not found', { status: 404 });
    ctx.waitUntil(cache.put(request, res.clone()));
    return res;
  }
  return null;
}
