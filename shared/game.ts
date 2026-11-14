// Core rules shared by the Worker (which is the source of truth) and the
// client (which uses them for instant feedback before asking the server).

export type Mark = 'correct' | 'present' | 'absent';

export type GameStatus = 'playing' | 'won' | 'lost';

/**
 * Scores a guess against the answer. Handles repeated letters the usual way:
 * exact matches are marked first, then remaining letters are marked present
 * only while unmatched copies remain in the answer.
 */
export function evaluate(guess: string, answer: string): Mark[] {
  const g = [...guess];
  const a = [...answer];
  if (g.length !== a.length) throw new Error('Guess and answer lengths differ');
  const marks: Mark[] = g.map(() => 'absent');
  const remaining = new Map<string, number>();
  for (let i = 0; i < a.length; i++) {
    if (g[i] === a[i]) marks[i] = 'correct';
    else remaining.set(a[i], (remaining.get(a[i]) ?? 0) + 1);
  }
  for (let i = 0; i < g.length; i++) {
    if (marks[i] === 'correct') continue;
    const left = remaining.get(g[i]) ?? 0;
    if (left > 0) {
      marks[i] = 'present';
      remaining.set(g[i], left - 1);
    }
  }
  return marks;
}

export type HardModeViolation =
  | { kind: 'position'; letter: string; position: number }
  | { kind: 'include'; letter: string; count: number };

/**
 * Hard mode: every revealed hint must be used in later guesses.
 * Green letters must stay in place, and yellow letters must be reused
 * (as many copies as have been revealed). Returns the first rule broken.
 */
export function checkHardMode(
  previous: { guess: string; marks: Mark[] }[],
  next: string,
): HardModeViolation | null {
  const n = [...next];
  const required = new Map<string, number>();
  for (const { guess, marks } of previous) {
    const g = [...guess];
    const counts = new Map<string, number>();
    for (let i = 0; i < g.length; i++) {
      if (marks[i] === 'correct' && n[i] !== g[i]) {
        return { kind: 'position', letter: g[i], position: i };
      }
      if (marks[i] !== 'absent') counts.set(g[i], (counts.get(g[i]) ?? 0) + 1);
    }
    for (const [letter, count] of counts) {
      if (count > (required.get(letter) ?? 0)) required.set(letter, count);
    }
  }
  for (const [letter, count] of required) {
    if (n.filter((c) => c === letter).length < count) return { kind: 'include', letter, count };
  }
  return null;
}

export function describeViolation(v: HardModeViolation): string {
  const L = v.letter.toLocaleUpperCase();
  if (v.kind === 'position') return `Letter ${v.position + 1} must be ${L}`;
  return v.count > 1 ? `Guess must contain ${v.count} × ${L}` : `Guess must contain ${L}`;
}

/** Normalises typed text into a lowercase, letters-only word for a language. */
export function normalizeWord(input: string, lang: string): string {
  return input
    .normalize('NFC')
    .toLocaleLowerCase(lang)
    .replace(/[^\p{L}]/gu, '');
}

export function statusAfter(marks: Mark[][], maxGuesses: number): GameStatus {
  const last = marks.at(-1);
  if (last && last.every((m) => m === 'correct')) return 'won';
  return marks.length >= maxGuesses ? 'lost' : 'playing';
}
