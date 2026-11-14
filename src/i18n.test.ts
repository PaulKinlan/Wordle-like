import { describe, expect, it } from 'vitest';
import de from './locales/de';
import en from './locales/en';
import es from './locales/es';
import fr from './locales/fr';
import it_ from './locales/it';
import nl from './locales/nl';
import pt from './locales/pt';

const locales = { de, es, fr, it: it_, nl, pt };
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const bold = (s: string) => (s.match(/\*\*/g) ?? []).length;

describe('interface translations', () => {
  for (const [code, messages] of Object.entries(locales)) {
    it(`${code} has every message, with the same placeholders`, () => {
      expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(placeholders(messages[key]), `${code} ${key}`).toEqual(placeholders(en[key]));
        expect(bold(messages[key]) % 2, `${code} ${key} bold markers`).toBe(0);
        expect(messages[key].trim(), `${code} ${key}`).not.toBe('');
      }
    });
  }
});
