import { describe, expect, it } from 'vitest';
import { shareText } from './share';
import type { SavedGame } from './storage';

const game: SavedGame = {
  puzzle: 'dh:2026-11-14',
  lang: 'en',
  mode: 'daily',
  number: 1,
  date: '2026-11-14',
  wordLength: 5,
  maxGuesses: 6,
  hard: true,
  status: 'won',
  answer: 'brief',
  rows: [
    { guess: 'crane', marks: ['absent', 'correct', 'absent', 'absent', 'present'] },
    { guess: 'brief', marks: Array(5).fill('correct') },
  ],
};

describe('shareText', () => {
  it('shows the score and grid without letters', () => {
    const text = shareText(game, false, 'https://example.dev');
    expect(text).toBe('Letterle #1 2/6 (hard)\n\n⬛🟩⬛⬛🟨\n🟩🟩🟩🟩🟩\n\nhttps://example.dev');
    expect(text).not.toMatch(/crane|brief/i);
  });
  it('marks a loss with X and uses high contrast squares', () => {
    const text = shareText({ ...game, status: 'lost', hard: false, mode: 'unlimited' }, true, 'u');
    expect(text.split('\n')[0]).toBe('Letterle Unlimited X/6');
    expect(text).toContain('⬛🟧⬛⬛🟦');
  });
  it('adds the daily streak, and the language when not English', () => {
    const text = shareText({ ...game, lang: 'es' }, false, 'u', 5);
    expect(text.split('\n').slice(0, 2)).toEqual(['Letterle ES #1 2/6 (hard)', '🔥 5 day streak']);
    expect(shareText(game, false, 'u', 1)).not.toContain('🔥');
    expect(shareText({ ...game, mode: 'unlimited' }, false, 'u', 9)).not.toContain('🔥');
  });
});
