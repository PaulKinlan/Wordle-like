// Word lists, keyed by language code. Bundled into the Worker, but each
// language is its own chunk and only loaded when someone plays in it, so a
// cold start doesn't parse all of them.
//
// candidates: common words that can be an answer (order is private, see answers.ts)
// rare:       rarely used words, the answers in hard mode
// guessable:  every word accepted as a guess, both answer pools included
//
// Answers keep their accents ("árbol") so the real spelling can be shown when
// a game ends. Guesses are compared in folded form ("arbol"), see
// normalizeWord in shared/game.ts.
import { normalizeWord } from '../shared/game';

export interface WordList {
  candidates: readonly string[];
  rare: readonly string[];
  /** Folded forms of every accepted guess. */
  guessable: ReadonlySet<string>;
}

type Raw = { candidates: string[]; rare: string[]; allowed: string[] };

const load = async (
  candidates: Promise<{ default: string[] }>,
  rare: Promise<{ default: string[] }>,
  allowed: Promise<{ default: string[] }>,
): Promise<Raw> => ({ candidates: (await candidates).default, rare: (await rare).default, allowed: (await allowed).default });

// Spelled out one by one so the bundler can see every file.
const bundled: Record<string, () => Promise<Raw>> = {
  en: () => load(import('./words/en/candidates.json'), import('./words/en/rare.json'), import('./words/en/allowed.json')),
  es: () => load(import('./words/es/candidates.json'), import('./words/es/rare.json'), import('./words/es/allowed.json')),
  fr: () => load(import('./words/fr/candidates.json'), import('./words/fr/rare.json'), import('./words/fr/allowed.json')),
  de: () => load(import('./words/de/candidates.json'), import('./words/de/rare.json'), import('./words/de/allowed.json')),
  it: () => load(import('./words/it/candidates.json'), import('./words/it/rare.json'), import('./words/it/allowed.json')),
  pt: () => load(import('./words/pt/candidates.json'), import('./words/pt/rare.json'), import('./words/pt/allowed.json')),
  nl: () => load(import('./words/nl/candidates.json'), import('./words/nl/rare.json'), import('./words/nl/allowed.json')),
  ca: () => load(import('./words/ca/candidates.json'), import('./words/ca/rare.json'), import('./words/ca/allowed.json')),
  eu: () => load(import('./words/eu/candidates.json'), import('./words/eu/rare.json'), import('./words/eu/allowed.json')),
  br: () => load(import('./words/br/candidates.json'), import('./words/br/rare.json'), import('./words/br/allowed.json')),
  pl: () => load(import('./words/pl/candidates.json'), import('./words/pl/rare.json'), import('./words/pl/allowed.json')),
  sv: () => load(import('./words/sv/candidates.json'), import('./words/sv/rare.json'), import('./words/sv/allowed.json')),
  tr: () => load(import('./words/tr/candidates.json'), import('./words/tr/rare.json'), import('./words/tr/allowed.json')),
  cy: () => load(import('./words/cy/candidates.json'), import('./words/cy/rare.json'), import('./words/cy/allowed.json')),
  ja: () => load(import('./words/ja/candidates.json'), import('./words/ja/rare.json'), import('./words/ja/allowed.json')),
  ko: () => load(import('./words/ko/candidates.json'), import('./words/ko/rare.json'), import('./words/ko/allowed.json')),
  ga: () => load(import('./words/ga/candidates.json'), import('./words/ga/rare.json'), import('./words/ga/allowed.json')),
  gd: () => load(import('./words/gd/candidates.json'), import('./words/gd/rare.json'), import('./words/gd/allowed.json')),
  el: () => load(import('./words/el/candidates.json'), import('./words/el/rare.json'), import('./words/el/allowed.json')),
};

const cache = new Map<string, Promise<WordList>>();

/** Whether there is a word list for this language (without loading it). */
export const hasWords = (lang: string) => Object.hasOwn(bundled, lang);

export function getWords(lang: string): Promise<WordList | undefined> {
  const hit = cache.get(lang);
  if (hit) return hit;
  if (!hasWords(lang)) return Promise.resolve(undefined);
  const fold = (w: string) => normalizeWord(w, lang);
  const list = bundled[lang]().then(
    (raw): WordList => ({
      candidates: raw.candidates,
      // A small language may have no rare words yet: hard mode then uses the common ones.
      rare: raw.rare.length ? raw.rare : raw.candidates,
      guessable: new Set([...raw.candidates.map(fold), ...raw.rare.map(fold), ...raw.allowed]),
    }),
  );
  // A failed load is tried again next time.
  list.catch(() => cache.delete(lang));
  cache.set(lang, list);
  return list;
}
