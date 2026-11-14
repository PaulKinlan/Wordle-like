// API Worker. Static files (the PWA) are served by Workers Static Assets;
// only /api/* reaches this code (see run_worker_first in wrangler.jsonc).
//
// Routes (all under /api/v1):
//   GET  /languages            supported languages
//   GET  /:lang/daily?date=&hard=1   today's puzzle id for the player's local date
//   POST /:lang/random?hard=1        a new unlimited-play puzzle id
//   GET  /:lang/words                every accepted guess, for instant validation
//   POST /:lang/play                 score guesses: { puzzle, guesses[] }
//
// Hard mode is part of the puzzle id: a rarely used answer, and revealed
// hints must be reused.
//
// The answers are never in this code; see answers.ts.
//
// Race rooms (multiplayer) are Durable Objects, see room.ts:
//   POST /rooms                 { lang, hard } -> { code }
//   GET  /rooms/:code/socket    WebSocket for one player
//
// Daily reminders by Web Push, see push.ts:
//   GET  /push/key, POST /push/subscribe, POST /push/unsubscribe
//
// Observability, see telemetry.ts:
//   POST /telemetry, POST /reports, GET /telemetry/summary, and GET /health
import { checkHardMode, describeViolation, evaluate, normalizeWord, statusAfter, type Mark } from '../shared/game';
import { getLanguage, LANGUAGES } from '../shared/languages';
import { D1AnswerStore, type AnswerStore } from './answers';
import { dailyIndex, dailyNumber, newRandomToken, parsePuzzleId, randomIndex } from './puzzles';
import { getWords, hasWords } from './words';
import { handlePush, sendDailyReminders, type PushEnv } from './push';
import { handleTelemetry, health, pruneTelemetry, recordEvent, recordServerError, type TelemetryEnv, type UsageEvent } from './telemetry';
import { ROOM_ALPHABET, ROOM_CODE } from '../shared/race';
import { handlePreview } from './og';
import { BadBody, readObject, withinLimit, type LimitEnv } from './http';

export { Room } from './room';

export interface Env extends PushEnv, TelemetryEnv, LimitEnv {
  ASSETS: Fetcher;
  /** Holds the private answer order. Created automatically on first deploy. */
  DB: D1Database;
  /** One Durable Object per race room. */
  ROOMS: DurableObjectNamespace;
}

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function json(body: unknown, init: ResponseInit & { cache?: string } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', init.cache ?? 'no-store');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(JSON.stringify(body), { ...init, headers });
}

const error = (status: number, code: string, message: string, extra: object = {}) =>
  json({ error: code, message, ...extra }, { status });

/** Usage events (a game started or finished) go to the dashboard; tests leave this out. */
type OnEvent = (e: UsageEvent) => void;

export async function handleApi(request: Request, answers: AnswerStore, onEvent: OnEvent = () => undefined): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'v1', ...]
  if (parts[0] !== 'api' || parts[1] !== 'v1') return error(404, 'not_found', 'Unknown API route');
  const [, , first, action] = parts;
  const method = request.method;

  if (first === 'languages' && parts.length === 3 && method === 'GET') {
    return json({ languages: LANGUAGES }, { cache: 'public, max-age=3600' });
  }

  const lang = first ? getLanguage(first) : undefined;
  if (!lang || parts.length !== 4) return error(404, 'not_found', 'Unknown API route');
  const list = await getWords(lang.code);
  if (!list) return error(404, 'not_found', 'No word list for this language');

  if (action === 'daily' && method === 'GET') {
    const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
    const id = `d${url.searchParams.get('hard') === '1' ? 'h' : ''}:${date}`;
    const ref = parsePuzzleId(id);
    if (!ref) return error(400, 'bad_date', 'That date has no puzzle yet');
    return json({ puzzle: id, number: dailyNumber(date), date, ...shape(lang) });
  }

  if (action === 'random' && method === 'POST') {
    const prefix = url.searchParams.get('hard') === '1' ? 'rh' : 'r';
    return json({ puzzle: `${prefix}:${newRandomToken()}`, ...shape(lang) });
  }

  if (action === 'words' && method === 'GET') {
    return json([...list.guessable], { cache: 'public, max-age=86400' });
  }

  if (action === 'play' && method === 'POST') {
    const body: { puzzle?: unknown; guesses?: unknown } = await readObject(request);
    const ref = parsePuzzleId(body.puzzle);
    if (!ref) return error(400, 'bad_puzzle', 'Unknown puzzle');
    if (!Array.isArray(body.guesses) || body.guesses.length < 1 || body.guesses.length > lang.maxGuesses) {
      return error(400, 'bad_request', 'Send between 1 and ' + lang.maxGuesses + ' guesses');
    }
    // Each pool has its own private order: "en" and "en:rare".
    const set = ref.hard ? `${lang.code}:rare` : lang.code;
    const count = await answers.count(set, ref.hard ? list.rare : list.candidates);
    // The stored answer keeps its accents for display; guesses are compared
    // with the folded form.
    const index = ref.kind === 'daily' ? dailyIndex(ref.number, count) : await randomIndex(await answers.key(), set, ref.token, count);
    const answer = await answers.at(set, index);
    const target = normalizeWord(answer, lang.code);
    const rows: { guess: string; marks: Mark[] }[] = [];
    for (const raw of body.guesses) {
      // Nothing a keyboard produces for one word is this long; don't spend time on it.
      const guess = typeof raw === 'string' && raw.length <= MAX_GUESS_CHARS ? normalizeWord(raw, lang.code) : '';
      if ([...guess].length !== lang.wordLength) {
        return error(400, 'wrong_length', `Guesses must be ${lang.wordLength} letters`, { word: guess.slice(0, MAX_GUESS_CHARS) });
      }
      if (!list.guessable.has(guess)) {
        return error(422, 'not_in_list', 'Not in word list', { word: guess });
      }
      if (ref.hard) {
        const v = checkHardMode(rows, guess);
        if (v) return error(422, 'hard_mode', describeViolation(v), { word: guess, violation: v });
      }
      rows.push({ guess, marks: evaluate(guess, target) });
      if (rows.at(-1)!.marks.every((m) => m === 'correct')) break;
    }
    const status = statusAfter(rows.map((r) => r.marks), lang.maxGuesses);
    // The client sends every guess so far with each new one, so one guess means a new game.
    const mode = String(body.puzzle).startsWith('d') ? 'daily' : 'unlimited';
    if (body.guesses.length === 1) onEvent({ kind: 'game_start', name: mode, message: lang.code, detail: { hard: ref.hard } });
    if (status !== 'playing') {
      onEvent({ kind: 'game', name: mode, rating: status, value: rows.length, message: lang.code, detail: { hard: ref.hard } });
    }
    return json({
      rows,
      status,
      hard: ref.hard,
      ...(status === 'playing' ? {} : { answer }),
    });
  }

  return error(404, 'not_found', 'Unknown API route');
}

/** The longest text accepted as one guess (Korean is typed as syllables, accents may be separate marks). */
const MAX_GUESS_CHARS = 64;

const shape = (lang: { code: string; wordLength: number; maxGuesses: number }) => ({
  lang: lang.code,
  wordLength: lang.wordLength,
  maxGuesses: lang.maxGuesses,
});

function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}

/** Creates race rooms and connects players to them. */
export async function handleRooms(request: Request, rooms: DurableObjectNamespace, onEvent: OnEvent = () => undefined): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'v1', 'rooms', ...]
  if (parts.length === 3 && request.method === 'POST') {
    const body: { lang?: unknown; hard?: unknown } = await readObject(request, 1024);
    const lang = typeof body.lang === 'string' ? getLanguage(body.lang) : undefined;
    if (!lang || !hasWords(lang.code)) return error(400, 'bad_language', 'Unknown language');
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newRoomCode();
      const stub = rooms.get(rooms.idFromName(code));
      const res = await stub.fetch('https://room/init', {
        method: 'POST',
        body: JSON.stringify({ code, lang: lang.code, hard: body.hard === true }),
      });
      if (res.ok) {
        onEvent({ kind: 'race', name: 'created', message: lang.code, detail: { hard: body.hard === true } });
        return json({ code });
      }
    }
    return error(503, 'busy', 'Could not make a race, try again');
  }
  if (parts.length === 5 && parts[4] === 'socket' && request.method === 'GET') {
    const code = parts[3].toUpperCase();
    if (!ROOM_CODE.test(code)) return error(404, 'no_room', 'No such race');
    // Only our own pages may open a socket (the browser always sends Origin).
    const origin = request.headers.get('Origin');
    if (origin && !sameHost(origin, url.host)) return error(403, 'forbidden', 'Wrong origin');
    const stub = rooms.get(rooms.idFromName(code));
    return stub.fetch(new Request('https://room/socket', request));
  }
  return error(404, 'not_found', 'Unknown API route');
}

function sameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false; // "null", or not a URL at all
  }
}

/** Which rate limit a request counts against (see http.ts); each scope has its own count per visitor. */
function limitFor(env: Env, method: string, path: string): [RateLimit | undefined, string] {
  if (path === '/api/v1/rooms' && method === 'POST') return [env.LIMIT_ROOMS, 'room'];
  if (path === '/api/v1/push/subscribe') return [env.LIMIT_WRITES, 'sub'];
  if (path === '/api/v1/telemetry' && method === 'POST') return [env.LIMIT_WRITES, 'tel'];
  if (path === '/api/v1/reports') return [env.LIMIT_WRITES, 'rep'];
  return [env.LIMIT_API, 'api'];
}

/**
 * The installed app's colours. Android colours the system navigation bar from
 * the manifest's theme_color, and a manifest can only have one, so a phone in
 * dark mode gets the dark one (the Sec-CH-Prefers-Color-Scheme client hint,
 * asked for in public/_headers). Chrome picks it up when it installs or
 * updates the app.
 */
async function manifest(request: Request, assets: Fetcher): Promise<Response> {
  const res = await assets.fetch(request);
  const headers = new Headers(res.headers);
  headers.append('Vary', 'Sec-CH-Prefers-Color-Scheme');
  if (!res.ok || request.headers.get('Sec-CH-Prefers-Color-Scheme') !== 'dark') return new Response(res.body, { status: res.status, headers });
  const m = (await res.json()) as Record<string, unknown>;
  m.theme_color = '#121316';
  m.background_color = '#121316';
  headers.delete('Content-Length');
  return new Response(JSON.stringify(m), { status: 200, headers });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return health(env.DB, json);
    if (url.pathname === '/manifest.webmanifest') return manifest(request, env.ASSETS);
    // Shared results (/s/...), race invites (/r/...) and their preview images (/og/...).
    if (/^\/(s|r|og)\//.test(url.pathname)) {
      try {
        const res = await handlePreview(request, env.ASSETS, ctx, () => withinLimit(env.LIMIT_WRITES, request, 'og'));
        if (res) return res;
      } catch (e) {
        console.error(e);
        ctx.waitUntil(recordServerError(env.DB, request, e));
      }
      // Anything unrecognised just opens the game.
      return env.ASSETS.fetch(new Request(new URL('/', request.url), request));
    }
    if (url.pathname.startsWith('/api/')) {
      const onEvent = (e: UsageEvent) => ctx.waitUntil(recordEvent(env.DB, request, e));
      try {
        const [limiter, scope] = limitFor(env, request.method, url.pathname);
        if (!(await withinLimit(limiter, request, scope))) {
          return error(429, 'slow_down', 'Too many requests. Try again in a minute.');
        }
        if (url.pathname.startsWith('/api/v1/rooms')) return await handleRooms(request, env.ROOMS, onEvent);
        if (url.pathname.startsWith('/api/v1/push/')) return await handlePush(request, env, json, error);
        if (url.pathname.startsWith('/api/v1/telemetry') || url.pathname === '/api/v1/reports') {
          return await handleTelemetry(request, env, json, error);
        }
        return await handleApi(request, new D1AnswerStore(env.DB), onEvent);
      } catch (e) {
        if (e instanceof BadBody) return error(e.status, e.status === 413 ? 'too_big' : 'bad_request', e.message);
        console.error(e);
        ctx.waitUntil(recordServerError(env.DB, request, e));
        return error(500, 'server_error', 'Something went wrong');
      }
    }
    return env.ASSETS.fetch(request);
  },

  /** Cron, every ten minutes (wrangler.jsonc): daily reminder notifications, and tidying old telemetry once an hour. */
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      sendDailyReminders(env).then(
        (r) => console.log('daily reminders', r),
        (e) => console.error('daily reminders failed', e),
      ),
    );
    if (new Date(controller.scheduledTime).getUTCMinutes() < 10) {
      ctx.waitUntil(pruneTelemetry(env.DB).catch((e) => console.error('telemetry prune failed', e)));
    }
  },
} satisfies ExportedHandler<Env>;
