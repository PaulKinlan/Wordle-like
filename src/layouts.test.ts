import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../shared/languages';
import { cycleKana, layoutFor, MARK_KEY } from './layouts';

describe('on-screen keyboard layouts', () => {
  for (const lang of LANGUAGES) {
    it(`${lang.code}: every letter can be typed, and nothing else`, () => {
      const { rows, cycles = [] } = layoutFor(lang.code);
      const keys = rows.flat().filter((k) => k && k !== MARK_KEY);
      const reachable = new Set(keys);
      for (const k of keys) for (let c = cycleKana(k, cycles); c !== k && !reachable.has(c); c = cycleKana(c, cycles)) reachable.add(c);
      for (const ch of lang.alphabet) expect(reachable, `${lang.code} missing ${ch}`).toContain(ch);
      for (const k of keys) expect(lang.alphabet, `${lang.code} extra ${k}`).toContain(k);
      expect(new Set(keys).size).toBe(keys.length);
      for (const r of rows) expect(r.length).toBeLessThanOrEqual(12);
    });
  }

  it('cycles kana through voiced and small forms', () => {
    const { cycles = [] } = layoutFor('ja');
    expect(cycleKana('は', cycles)).toBe('ば');
    expect(cycleKana('ば', cycles)).toBe('ぱ');
    expect(cycleKana('ぱ', cycles)).toBe('は');
    expect(cycleKana('つ', cycles)).toBe('っ');
    expect(cycleKana('ん', cycles)).toBe('ん');
  });
});
