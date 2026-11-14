import { HANGUL_KEYS } from './hangul';

// Supported languages. Adding a language means adding an entry here and a
// word list under worker/words/<code>/ (see worker/words.ts and
// scripts/build-wordlists.mjs).

export interface LanguageInfo {
  /** BCP 47 language code, also used in API paths: /api/v1/<code>/... */
  code: string;
  /** English name. */
  name: string;
  /** Name in the language itself, shown in the picker. */
  nativeName: string;
  wordLength: number;
  maxGuesses: number;
  /**
   * The letters that count as different letters in this language, in
   * alphabetical order. Any other accented letter is folded to its base
   * letter, so "é" can be typed as "e" (or as "é") in French, while "ñ" stays
   * its own letter in Spanish and "ä" its own letter in German.
   */
  alphabet: string;
  /** Letters that are written differently but count as one, like Greek final ς (σ). */
  fold?: Record<string, string>;
  /**
   * Pairs of letters that are one letter in this language, and take one tile:
   * Welsh ll, dd, ch... Inside the game each is a single private-use character
   * (see digraphChar), so everything that counts letters just works.
   */
  digraphs?: string[];
  /** Korean: syllable blocks are split into the letters typed for them (see shared/hangul.ts). */
  hangul?: boolean;
}

/** The single character a digraph is stored as: U+E000 onwards, in the order of DIGRAPHS. */
export const DIGRAPHS = ['ch', 'dd', 'ff', 'ng', 'll', 'ph', 'rh', 'th'];
export const digraphChar = (d: string) => String.fromCharCode(0xe000 + DIGRAPHS.indexOf(d));
const WELSH = 'a b c ch d dd e f ff g ng h i j l ll m n o p ph r rh s t th u w y'
  .split(' ')
  .map((l) => (l.length > 1 ? digraphChar(l) : l))
  .join('');

const LATIN = 'abcdefghijklmnopqrstuvwxyz';

// Japanese: hiragana (ぁ to ゔ, without the old ゐ and ゑ) and the long vowel
// mark. Katakana folds to hiragana, so either can be typed.
const HIRAGANA =
  Array.from({ length: 0x3094 - 0x3041 + 1 }, (_, i) => String.fromCodePoint(0x3041 + i))
    .filter((c) => c !== 'ゐ' && c !== 'ゑ')
    .join('') + 'ー';
const KATAKANA_FOLD = Object.fromEntries(
  Array.from({ length: 0x30f6 - 0x30a1 + 1 }, (_, i) => [String.fromCodePoint(0x30a1 + i), String.fromCodePoint(0x3041 + i)]),
);

export const LANGUAGES: LanguageInfo[] = [
  { code: 'en', name: 'English', nativeName: 'English', wordLength: 5, maxGuesses: 6, alphabet: LATIN },
  { code: 'es', name: 'Spanish', nativeName: 'Español', wordLength: 5, maxGuesses: 6, alphabet: 'abcdefghijklmnñopqrstuvwxyz' },
  { code: 'fr', name: 'French', nativeName: 'Français', wordLength: 5, maxGuesses: 6, alphabet: LATIN },
  { code: 'de', name: 'German', nativeName: 'Deutsch', wordLength: 5, maxGuesses: 6, alphabet: 'aäbcdefghijklmnoöpqrsßtuüvwxyz' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', wordLength: 5, maxGuesses: 6, alphabet: LATIN },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', wordLength: 5, maxGuesses: 6, alphabet: LATIN },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', wordLength: 5, maxGuesses: 6, alphabet: LATIN },
  { code: 'ca', name: 'Catalan', nativeName: 'Català', wordLength: 5, maxGuesses: 6, alphabet: 'abcçdefghijklmnopqrstuvwxyz' },
  { code: 'eu', name: 'Basque', nativeName: 'Euskara', wordLength: 5, maxGuesses: 6, alphabet: 'abcdefghijklmnñopqrstuvwxyz' },
  { code: 'cy', name: 'Welsh', nativeName: 'Cymraeg', wordLength: 5, maxGuesses: 6, alphabet: WELSH, digraphs: ['ch', 'dd', 'ff', 'ng', 'll', 'ph', 'rh', 'th'] },
  { code: 'ga', name: 'Irish', nativeName: 'Gaeilge', wordLength: 5, maxGuesses: 6, alphabet: LATIN },
  { code: 'gd', name: 'Scottish Gaelic', nativeName: 'Gàidhlig', wordLength: 5, maxGuesses: 6, alphabet: LATIN },
  { code: 'br', name: 'Breton', nativeName: 'Brezhoneg', wordLength: 5, maxGuesses: 6, alphabet: 'abcdefghijklmnñopqrstuvwxyz' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', wordLength: 5, maxGuesses: 6, alphabet: 'aąbcćdeęfghijklłmnńoópqrsśtuvwxyzźż' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', wordLength: 5, maxGuesses: 6, alphabet: 'abcdefghijklmnopqrstuvwxyzåäö' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', wordLength: 5, maxGuesses: 6, alphabet: 'abcçdefgğhıijklmnoöprsştuüvyz' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', wordLength: 5, maxGuesses: 6, alphabet: 'αβγδεζηθικλμνξοπρστυφχψω', fold: { ς: 'σ' } },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', wordLength: 4, maxGuesses: 8, alphabet: HIRAGANA, fold: KATAKANA_FOLD },
  { code: 'ko', name: 'Korean', nativeName: '한국어', wordLength: 6, maxGuesses: 6, alphabet: HANGUL_KEYS, hangul: true },
];

export const DEFAULT_LANGUAGE = 'en';

export function getLanguage(code: string): LanguageInfo | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

/**
 * Orders languages for the picker: languages hinted by the keyboard layout
 * first, then the device's preferred languages (navigator.languages), then
 * every other supported language. Matching is on the primary subtag, so
 * "en-GB" matches "en".
 */
export function orderLanguages(
  supported: string[],
  preferred: readonly string[],
  keyboardHints: readonly string[] = [],
): string[] {
  const primary = (tag: string) => tag.toLowerCase().split('-')[0];
  const out: string[] = [];
  for (const tag of [...keyboardHints, ...preferred]) {
    const match = supported.find((s) => primary(s) === primary(tag));
    if (match && !out.includes(match)) out.push(match);
  }
  for (const s of supported) if (!out.includes(s)) out.push(s);
  return out;
}
