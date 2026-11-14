import type { Mark } from '../shared/game';
import type { Row } from './storage';

const rank: Record<Mark, number> = { absent: 0, present: 1, correct: 2 };

/**
 * What earlier rows say about each letter, for hints on the row being typed.
 * Works per tile, so a Welsh digraph, a Korean jamo or a kana is one letter.
 */
export function letterHints(rows: Row[]) {
  const best = new Map<string, Mark>();
  const correctAt = new Set<string>();
  for (const { guess, marks } of rows) {
    [...guess].forEach((ch, i) => {
      // Race rows hide an unplayed guess as spaces.
      if (!ch.trim() || !marks[i]) return;
      const prev = best.get(ch);
      if (!prev || rank[marks[i]] > rank[prev]) best.set(ch, marks[i]);
      if (marks[i] === 'correct') correctAt.add(`${i}:${ch}`);
    });
  }
  return {
    best,
    /** The hint for a letter typed in column i: correct only if it was green right here. */
    at(ch: string | undefined, i: number): Mark | undefined {
      if (!ch) return undefined;
      if (correctAt.has(`${i}:${ch}`)) return 'correct';
      const b = best.get(ch);
      return b === 'correct' ? 'present' : b;
    },
  };
}
