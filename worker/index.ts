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
import { answerIndex, dailyNumber, newRandomToken, parsePuzzleId } from './puzzles';
import { getWords } from './words';
import { handlePush, sendDailyReminders, type PushEnv } from './push';
import { handleTelemetry, health, pruneTelemetry, recordServerError, type TelemetryEnv } from './telemetry';
import { ROOM_ALPHABET, ROOM_CODE } from '../shared/race';

export { Room } from './room';

export interface Env extends PushEnv, TelemetryEnv {
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

export async function handleApi(request: Request, answers: AnswerStore): Promise<Response> {
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
  const list = getWords(lang.code);
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
    let body: { puzzle?: unknown; guesses?: unknown };
    try {
      body = await request.json();
    } catch {
      return error(400, 'bad_request', 'Expected a JSON body');
    }
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
    const answer = await answers.at(set, answerIndex(ref, count));
    const target = normalizeWord(answer, lang.code);
    const rows: { guess: string; marks: Mark[] }[] = [];
    for (const raw of body.guesses) {
      const guess = typeof raw === 'string' ? normalizeWord(raw, lang.code) : '';
      if ([...guess].length !== lang.wordLength) {
        return error(400, 'wrong_length', `Guesses must be ${lang.wordLength} letters`, { word: guess });
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
    return json({
      rows,
      status,
      hard: ref.hard,
      ...(status === 'playing' ? {} : { answer }),
    });
  }

  return error(404, 'not_found', 'Unknown API route');
}

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
export async function handleRooms(request: Request, rooms: DurableObjectNamespace): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'v1', 'rooms', ...]
  if (parts.length === 3 && request.method === 'POST') {
    let body: { lang?: unknown; hard?: unknown };
    try {
      body = await request.json();
    } catch {
      return error(400, 'bad_request', 'Expected a JSON body');
    }
    const lang = typeof body.lang === 'string' ? getLanguage(body.lang) : undefined;
    if (!lang || !getWords(lang.code)) return error(400, 'bad_language', 'Unknown language');
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newRoomCode();
      const stub = rooms.get(rooms.idFromName(code));
      const res = await stub.fetch('https://room/init', {
        method: 'POST',
        body: JSON.stringify({ code, lang: lang.code, hard: body.hard === true }),
      });
      if (res.ok) return json({ code });
    }
    return error(503, 'busy', 'Could not make a race, try again');
  }
  if (parts.length === 5 && parts[4] === 'socket' && request.method === 'GET') {
    const code = parts[3].toUpperCase();
    if (!ROOM_CODE.test(code)) return error(404, 'no_room', 'No such race');
    // Only our own pages may open a socket (the browser always sends Origin).
    const origin = request.headers.get('Origin');
    if (origin && new URL(origin).host !== url.host) return error(403, 'forbidden', 'Wrong origin');
    const stub = rooms.get(rooms.idFromName(code));
    return stub.fetch(new Request('https://room/socket', request));
  }
  return error(404, 'not_found', 'Unknown API route');
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return health(env.DB, json);
    if (url.pathname.startsWith('/api/')) {
      try {
        if (url.pathname.startsWith('/api/v1/rooms')) return await handleRooms(request, env.ROOMS);
        if (url.pathname.startsWith('/api/v1/push/')) return await handlePush(request, env, json, error);
        if (url.pathname.startsWith('/api/v1/telemetry') || url.pathname === '/api/v1/reports') {
          return await handleTelemetry(request, env, json, error);
        }
        return await handleApi(request, new D1AnswerStore(env.DB));
      } catch (e) {
        console.error(e);
        ctx.waitUntil(recordServerError(env.DB, request, e));
        return error(500, 'server_error', 'Something went wrong');
      }
    }
    return env.ASSETS.fetch(request);
  },

  /** Hourly cron (wrangler.jsonc): daily reminder notifications, and tidying old telemetry. */
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      sendDailyReminders(env).then(
        (r) => console.log('daily reminders', r),
        (e) => console.error('daily reminders failed', e),
      ),
    );
    ctx.waitUntil(pruneTelemetry(env.DB).catch((e) => console.error('telemetry prune failed', e)));
  },
} satisfies ExportedHandler<Env>;
