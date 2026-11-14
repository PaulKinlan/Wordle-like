import { describe, expect, it } from 'vitest';
import { letterHints } from './hints';

describe('letterHints', () => {
  it('marks letters by what earlier rows showed', () => {
    const k = letterHints([{ guess: 'crane', marks: ['absent', 'correct', 'present', 'absent', 'absent'] }]);
    expect(k.at('c', 0)).toBe('absent');
    expect(k.at('r', 1)).toBe('correct');
    // Green elsewhere: only "in the word" in another column.
    expect(k.at('r', 3)).toBe('present');
    expect(k.at('a', 0)).toBe('present');
    expect(k.at('z', 0)).toBeUndefined();
    expect(k.at(undefined, 0)).toBeUndefined();
  });

  it('keeps the best mark for a repeated letter', () => {
    const k = letterHints([{ guess: 'geese', marks: ['absent', 'absent', 'present', 'absent', 'absent'] }]);
    expect(k.at('e', 0)).toBe('present');
  });

  it('treats one tile as one letter (Welsh digraph, Korean jamo) and skips hidden race rows', () => {
    const ll = '';
    const k = letterHints([
      { guess: `${ll}ㅎㅏ`, marks: ['correct', 'absent', 'present'] },
      { guess: '   ', marks: ['absent', 'absent', 'absent'] },
    ]);
    expect(k.at(ll, 0)).toBe('correct');
    expect(k.at('l', 0)).toBeUndefined();
    expect(k.at('ㅎ', 2)).toBe('absent');
    expect(k.at(' ', 0)).toBeUndefined();
  });
});
