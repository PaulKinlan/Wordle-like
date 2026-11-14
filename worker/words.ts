// Word lists, keyed by language code. Bundled into the Worker.
//
// candidates: words that can be an answer (their order is private, see answers.ts)
// guessable:  every word accepted as a guess, candidates included
import enCandidates from './words/en/candidates.json';
import enAllowed from './words/en/allowed.json';

export interface WordList {
  candidates: readonly string[];
  guessable: ReadonlySet<string>;
}

const bundled: Record<string, { candidates: string[]; allowed: string[] }> = {
  en: { candidates: enCandidates, allowed: enAllowed },
};

const cache = new Map<string, WordList>();

export function getWords(lang: string): WordList | undefined {
  const hit = cache.get(lang);
  if (hit) return hit;
  const raw = bundled[lang];
  if (!raw) return undefined;
  const list: WordList = {
    candidates: raw.candidates,
    guessable: new Set([...raw.candidates, ...raw.allowed]),
  };
  cache.set(lang, list);
  return list;
}
