// API Worker. Static files (the PWA) are served by Workers Static Assets;
// only /api/* reaches this code (see run_worker_first in wrangler.jsonc).
//
// Routes (all under /api/v1):
//   GET  /languages            supported languages
//   GET  /:lang/daily?date=    today's puzzle id for the player's local date
//   POST /:lang/random         a new unlimited-play puzzle id
//   GET  /:lang/words          every accepted guess, for instant validation
//   POST /:lang/play           score guesses: { puzzle, guesses[], hard }
//
// Future steps plug in here: multiplayer rooms as a Durable Object under
// /api/v1/rooms/*, and Web Push subscriptions under /api/v1/push/*.
import { checkHardMode, describeViolation, evaluate, normalizeWord, statusAfter, type Mark } from '../shared/game';
import { getLanguage, LANGUAGES } from '../shared/languages';
import { answerFor, dailyNumber, newRandomToken, parsePuzzleId } from './puzzles';
import { bundledWords, type WordSource } from './words';

export interface Env {
  ASSETS: Fetcher;
  /** Mixed into answer selection. Set with `wrangler secret put PUZZLE_SECRET`. */
  PUZZLE_SECRET?: string;
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

export async function handleApi(request: Request, env: Env, words: WordSource = bundledWords): Promise<Response> {
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
  const list = await words.get(lang.code);
  if (!list) return error(404, 'not_found', 'No word list for this language');
  const secret = env.PUZZLE_SECRET || 'dev-only-secret';

  if (action === 'daily' && method === 'GET') {
    const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
    const id = `d:${date}`;
    const ref = parsePuzzleId(id);
    if (!ref) return error(400, 'bad_date', 'That date has no puzzle yet');
    return json({ puzzle: id, number: dailyNumber(date), date, ...shape(lang) });
  }

  if (action === 'random' && method === 'POST') {
    return json({ puzzle: `r:${newRandomToken()}`, ...shape(lang) });
  }

  if (action === 'words' && method === 'GET') {
    return json([...list.guessable], { cache: 'public, max-age=86400' });
  }

  if (action === 'play' && method === 'POST') {
    let body: { puzzle?: unknown; guesses?: unknown; hard?: unknown };
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
    const answer = await answerFor(ref, lang.code, list.answers, secret);
    const rows: { guess: string; marks: Mark[] }[] = [];
    for (const raw of body.guesses) {
      const guess = typeof raw === 'string' ? normalizeWord(raw, lang.code) : '';
      if ([...guess].length !== lang.wordLength) {
        return error(400, 'wrong_length', `Guesses must be ${lang.wordLength} letters`, { word: guess });
      }
      if (!list.guessable.has(guess)) {
        return error(422, 'not_in_list', 'Not in word list', { word: guess });
      }
      if (body.hard === true) {
        const v = checkHardMode(rows, guess);
        if (v) return error(422, 'hard_mode', describeViolation(v), { word: guess, violation: v });
      }
      rows.push({ guess, marks: evaluate(guess, answer) });
      if (rows.at(-1)!.marks.every((m) => m === 'correct')) break;
    }
    const status = statusAfter(rows.map((r) => r.marks), lang.maxGuesses);
    return json({
      rows,
      status,
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

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env);
      } catch (e) {
        console.error(e);
        return error(500, 'server_error', 'Something went wrong');
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
