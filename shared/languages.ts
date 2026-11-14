// Supported languages. Adding a language means adding an entry here and a
// word list under worker/words/<code>/ (see worker/words.ts).

export interface LanguageInfo {
  /** BCP 47 language code, also used in API paths: /api/v1/<code>/... */
  code: string;
  /** English name. */
  name: string;
  /** Name in the language itself, shown in the picker. */
  nativeName: string;
  wordLength: number;
  maxGuesses: number;
}

export const LANGUAGES: LanguageInfo[] = [
  { code: 'en', name: 'English', nativeName: 'English', wordLength: 5, maxGuesses: 6 },
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
