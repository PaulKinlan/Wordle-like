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
}

const LATIN = 'abcdefghijklmnopqrstuvwxyz';

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
  { code: 'ga', name: 'Irish', nativeName: 'Gaeilge', wordLength: 5, maxGuesses: 6, alphabet: LATIN },
  { code: 'gd', name: 'Scottish Gaelic', nativeName: 'Gàidhlig', wordLength: 5, maxGuesses: 6, alphabet: LATIN },
  { code: 'br', name: 'Breton', nativeName: 'Brezhoneg', wordLength: 5, maxGuesses: 6, alphabet: 'abcdefghijklmnñopqrstuvwxyz' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', wordLength: 5, maxGuesses: 6, alphabet: 'aąbcćdeęfghijklłmnńoópqrsśtuvwxyzźż' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', wordLength: 5, maxGuesses: 6, alphabet: 'abcdefghijklmnopqrstuvwxyzåäö' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', wordLength: 5, maxGuesses: 6, alphabet: 'abcçdefgğhıijklmnoöprsştuüvyz' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', wordLength: 5, maxGuesses: 6, alphabet: 'αβγδεζηθικλμνξοπρστυφχψω', fold: { ς: 'σ' } },
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
