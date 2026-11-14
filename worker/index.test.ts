import { describe, expect, it } from 'vitest';
import { MemoryAnswerStore, shuffle } from './answers';
import { handleApi, handleRooms } from './index';
import { dailyIndex, dailyNumber, parsePuzzleId, randomIndex } from './puzzles';

const store = new MemoryAnswerStore();
const call = (path: string, init?: RequestInit) => handleApi(new Request('https://x' + path, init), store);
const play = (body: object) =>
  call('/api/v1/en/play', { method: 'POST', body: JSON.stringify(body) }).then(async (r) => ({
    status: r.status,
    body: (await r.json()) as any,
  }));

describe('puzzle ids', () => {
  it('numbers daily puzzles from the epoch', () => {
    expect(dailyNumber('2026-11-14')).toBe(1);
    expect(dailyNumber('2026-11-15')).toBe(2);
    expect(dailyNumber('2026-02-30')).toBeNull();
  });
  it('refuses puzzles from the future', () => {
    // A day is served once it has started somewhere: UTC+14 is the furthest ahead.
    expect(parsePuzzleId('d:2026-12-02', Date.parse('2026-12-01T09:00:00Z'))).toBeNull();
    expect(parsePuzzleId('d:2026-12-02', Date.parse('2026-12-01T10:00:00Z'))).not.toBeNull();
    expect(parsePuzzleId('d:2026-12-04', Date.parse('2026-12-01T12:00:00Z'))).toBeNull();
    expect(parsePuzzleId('r:nothex')).toBeNull();
  });
  it('maps daily puzzles onto the private order', () => {
    expect(dailyIndex(1, 10)).toBe(0);
    expect(dailyIndex(12, 10)).toBe(1);
    expect(parsePuzzleId('dh:2026-11-14', Date.parse('2026-11-14T00:00:00Z'))).toMatchObject({ hard: true, number: 1 });
  });
  it("doesn't let an unlimited token pick its row", async () => {
    const at = (key: string, token: string) => randomIndex(key, 'en', token, 2000);
    // The same token always means the same word...
    expect(await at('k1', '0000000000000001')).toBe(await at('k1', '0000000000000001'));
    // ...but which word depends on the server's key, not on the number in the token.
    const rows = await Promise.all(['0000000000000000', '0000000000000001', '0000000000000002'].map((t) => at('k1', t)));
    expect(rows).not.toEqual([0, 1, 2]);
    expect(await Promise.all(['0000000000000000', '0000000000000001', '0000000000000002'].map((t) => at('k2', t)))).not.toEqual(rows);
    // Each word pool has its own mapping.
    expect(await randomIndex('k1', 'en:rare', '0000000000000001', 2000)).not.toBe(rows[1]);
    for (const r of rows) expect(r).toBeGreaterThanOrEqual(0);
  });
  it('shuffles every word exactly once', () => {
    const words = Array.from({ length: 500 }, (_, i) => 'w' + i);
    const out = shuffle(words);
    expect(out).not.toEqual(words);
    expect([...out].sort()).toEqual([...words].sort());
  });
});

describe('API', () => {
  it('lists languages', async () => {
    const r = await call('/api/v1/languages');
    expect(((await r.json()) as any).languages[0].code).toBe('en');
    expect(r.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });

  it('returns a daily puzzle', async () => {
    const body = (await (await call('/api/v1/en/daily?date=2026-11-14')).json()) as any;
    expect(body).toMatchObject({ puzzle: 'd:2026-11-14', number: 1, wordLength: 5, maxGuesses: 6 });
  });

  it('scores guesses, then reveals the answer when the game ends', async () => {
    const puzzle = 'd:2026-11-14';
    const first = await play({ puzzle, guesses: ['crane'] });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('playing');
    expect(first.body.answer).toBeUndefined();

    const lost = await play({ puzzle, guesses: Array(6).fill('fuzzy') });
    const answer = lost.body.answer as string;
    if (answer === 'fuzzy') return;
    expect(lost.body.status).toBe('lost');

    const won = await play({ puzzle, guesses: ['crane', answer] });
    expect(won.body.status).toBe('won');
    expect(won.body.rows[1].marks).toEqual(Array(5).fill('correct'));
  });

  it('rejects unknown words and enforces hard mode', async () => {
    const puzzle = 'r:0123456789abcdef';
    expect((await play({ puzzle, guesses: ['zzzzz'] })).body.error).toBe('not_in_list');
    const answer = (await play({ puzzle, guesses: Array(6).fill('fuzzy') })).body.answer as string;
    const words = (await (await call('/api/v1/en/words')).json()) as string[];
    // A guess that reveals a green first letter, then one that ignores it.
    const first = words.find((w) => w[0] === answer[0] && w !== answer)!;
    const second = words.find((w) => w[0] !== answer[0])!;
    // Hard mode is part of the puzzle id; the normal puzzle doesn't enforce it.
    expect((await play({ puzzle, guesses: [first, second] })).status).toBe(200);
    const hardPuzzle = 'rh:0123456789abcdef';
    const hardAnswer = (await play({ puzzle: hardPuzzle, guesses: Array(6).fill('fuzzy') })).body.answer as string;
    const h1 = words.find((w) => w[0] === hardAnswer[0] && w !== hardAnswer)!;
    const h2 = words.find((w) => w[0] !== hardAnswer[0])!;
    const r = await play({ puzzle: hardPuzzle, guesses: [h1, h2] });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ error: 'hard_mode', violation: { kind: 'position', position: 0 } });
  });

  it('draws hard mode answers from the rare words', async () => {
    const rare = new Set((await import('./words/en/rare.json')).default as string[]);
    const common = new Set((await import('./words/en/candidates.json')).default as string[]);
    for (const date of ['2026-11-14', '2026-11-15']) {
      const hard = (await play({ puzzle: `dh:${date}`, guesses: Array(6).fill('fuzzy') })).body;
      const normal = (await play({ puzzle: `d:${date}`, guesses: Array(6).fill('fuzzy') })).body;
      expect(hard.hard).toBe(true);
      expect(rare.has(hard.answer) || hard.answer === undefined).toBe(true);
      expect(common.has(normal.answer) || normal.answer === undefined).toBe(true);
    }
    const daily = (await (await call('/api/v1/en/daily?date=2026-11-14&hard=1')).json()) as any;
    expect(daily.puzzle).toBe('dh:2026-11-14');
  });
});

describe('languages', () => {
  it('has word lists for every language, in the right shape', async () => {
    const { LANGUAGES } = await import('../shared/languages');
    const { normalizeWord } = await import('../shared/game');
    const { getWords } = await import('./words');
    for (const lang of LANGUAGES) {
      const list = (await getWords(lang.code))!;
      expect(list, lang.code).toBeDefined();
      // At least two years of daily words.
      expect(list.candidates.length, lang.code).toBeGreaterThan(730);
      expect(list.rare.length, lang.code).toBeGreaterThan(100);
      for (const w of [...list.candidates, ...list.rare]) {
        const folded = normalizeWord(w, lang.code);
        expect([...folded].length, w).toBe(lang.wordLength);
        expect(list.guessable.has(folded), w).toBe(true);
      }
      for (const w of list.guessable) expect(normalizeWord(w, lang.code), w).toBe(w);
    }
  });

  it('plays in Spanish with or without accents, and reveals the accented answer', async () => {
    const puzzle = 'r:00000000000000aa';
    const post = (guesses: string[]) =>
      call('/api/v1/es/play', { method: 'POST', body: JSON.stringify({ puzzle, guesses }) }).then((r) => r.json() as any);
    const { getWords } = await import('./words');
    const filler = [...(await getWords('es'))!.guessable][0];
    const lost = await post(Array(6).fill(filler));
    const answer = lost.answer as string;
    if (!answer) return; // the filler happened to be the answer
    const plain = answer.normalize('NFD').replace(/[̀-̂̈]/g, '').normalize('NFC');
    const won = await post([plain.toUpperCase()]);
    expect(won.status).toBe('won');
    expect(won.answer).toBe(answer);
  });

  it('keeps each language in its own private order', async () => {
    const res = await call('/api/v1/de/daily?date=2026-11-14');
    expect(((await res.json()) as any).lang).toBe('de');
    expect((await call('/api/v1/xx/daily')).status).toBe(404);
  });
});

describe('race rooms API', () => {
  const calls: string[] = [];
  const rooms = {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.url;
        calls.push(`${id} ${url} ${init?.body ?? ''}`);
        return new Response('ok');
      },
    }),
  } as unknown as DurableObjectNamespace;
  const rooms$ = (path: string, init?: RequestInit) => handleRooms(new Request('https://x' + path, init), rooms);

  it('creates a room with a readable code', async () => {
    const res = await rooms$('/api/v1/rooms', { method: 'POST', body: JSON.stringify({ lang: 'es', hard: true }) });
    const { code } = (await res.json()) as { code: string };
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(calls.at(-1)).toContain(`"code":"${code}","lang":"es","hard":true`);
  });

  it('rejects unknown languages, bad codes and other sites', async () => {
    expect((await rooms$('/api/v1/rooms', { method: 'POST', body: '{"lang":"xx"}' })).status).toBe(400);
    expect((await rooms$('/api/v1/rooms/ABC/socket')).status).toBe(404);
    const other = await rooms$('/api/v1/rooms/ABCDEF/socket', { headers: { Origin: 'https://evil.example' } });
    expect(other.status).toBe(403);
  });
});

describe('bad input', () => {
  const post = (path: string, body: string) => handleApi(new Request('https://x' + path, { method: 'POST', body }), store);
  it('refuses a body that is not a JSON object', async () => {
    for (const body of ['null', '[]', '"x"', 'nope', '']) {
      await expect(post('/api/v1/en/play', body)).rejects.toMatchObject({ status: 400 });
    }
  });
  it('refuses a body that is too big', async () => {
    await expect(post('/api/v1/en/play', JSON.stringify({ puzzle: 'd:2026-11-14', guesses: ['a'.repeat(20000)] }))).rejects.toMatchObject({ status: 413 });
  });
  it("doesn't echo or process an over-long guess", async () => {
    const r = await play({ puzzle: 'd:2026-11-14', guesses: ['a'.repeat(500)] });
    expect(r.status).toBe(400);
    expect(r.body.word).toBe('');
  });
});
