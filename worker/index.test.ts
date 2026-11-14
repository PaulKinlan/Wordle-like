import { describe, expect, it } from 'vitest';
import { handleApi, type Env } from './index';
import { dailyNumber, parsePuzzleId } from './puzzles';

const env = { PUZZLE_SECRET: 'test' } as Env;
const call = (path: string, init?: RequestInit) => handleApi(new Request('https://x' + path, init), env);
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
    const now = Date.parse('2026-12-01T12:00:00Z');
    expect(parsePuzzleId('d:2026-12-02', now)).not.toBeNull();
    expect(parsePuzzleId('d:2026-12-04', now)).toBeNull();
    expect(parsePuzzleId('r:nothex', now)).toBeNull();
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
    const r = await play({ puzzle, guesses: [first, second], hard: true });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ error: 'hard_mode', violation: { kind: 'position', position: 0 } });
    expect((await play({ puzzle, guesses: [first, second] })).status).toBe(200);
  });
});
