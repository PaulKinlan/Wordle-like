import { describe, expect, it } from 'vitest';
import { cleanAnswer, MemoryAnswerStore } from './answers';
import { isBlocked } from './blocklist';

describe('offensive-word blocklist', () => {
  it('matches per language, ignoring case, including the hard set', () => {
    expect(isBlocked('en', 'CHINK')).toBe(true);
    expect(isBlocked('en:rare', 'nigga')).toBe(true);
    expect(isBlocked('en', 'crane')).toBe(false);
    expect(isBlocked('pl', 'kurwa')).toBe(true);
    expect(isBlocked('en', 'kurwa')).toBe(false);
    // Greek final sigma counts as sigma.
    expect(isBlocked('el', 'μαλάκας')).toBe(true);
  });

  it('skips a blocked answer to the next word in the stored order', async () => {
    const order = ['crane', 'chink', 'tiger'];
    const read = async (i: number) => order[i];
    expect(await cleanAnswer('en', 0, 3, read)).toBe('crane');
    expect(await cleanAnswer('en', 1, 3, read)).toBe('tiger');
  });

  it('wraps around at the end of the order', async () => {
    const order = ['crane', 'tiger', 'chink'];
    expect(await cleanAnswer('en', 2, 3, async (i) => order[i])).toBe('crane');
  });

  it('applies to the store used by the API', async () => {
    const store = new MemoryAnswerStore((c) => [...c]);
    const n = await store.count('en', ['chink', 'crane']);
    expect(n).toBe(2);
    expect(await store.at('en', 0)).toBe('crane');
  });
});
