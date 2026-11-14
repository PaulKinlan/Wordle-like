// Word lists, keyed by language code. Bundled into the Worker.
//
// candidates: common words that can be an answer (order is private, see answers.ts)
// rare:       rarely used words, the answers in hard mode
// guessable:  every word accepted as a guess, both answer pools included
import enAllowed from './words/en/allowed.json';
import enCandidates from './words/en/candidates.json';
import enRare from './words/en/rare.json';

export interface WordList {
  candidates: readonly string[];
  rare: readonly string[];
  guessable: ReadonlySet<string>;
}

const bundled: Record<string, { candidates: string[]; rare: string[]; allowed: string[] }> = {
  en: { candidates: enCandidates, rare: enRare, allowed: enAllowed },
};

const cache = new Map<string, WordList>();

export function getWords(lang: string): WordList | undefined {
  const hit = cache.get(lang);
  if (hit) return hit;
  const raw = bundled[lang];
  if (!raw) return undefined;
  const list: WordList = {
    candidates: raw.candidates,
    rare: raw.rare,
    guessable: new Set([...raw.candidates, ...raw.rare, ...raw.allowed]),
  };
  cache.set(lang, list);
  return list;
}
