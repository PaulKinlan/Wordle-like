// Word lists, keyed by language code.
//
// Lists are bundled into the Worker today. The WordSource interface is the
// seam for moving them to KV or R2 later without touching the API code.
import enAnswers from './words/en/answers.json';
import enAllowed from './words/en/allowed.json';

export interface WordList {
  /** Words that can be picked as the answer, in a stable order. */
  answers: readonly string[];
  /** Every word accepted as a guess (answers included). */
  guessable: ReadonlySet<string>;
}

export interface WordSource {
  get(lang: string): Promise<WordList | undefined>;
}

const bundled: Record<string, { answers: string[]; allowed: string[] }> = {
  en: { answers: enAnswers, allowed: enAllowed },
};

const cache = new Map<string, WordList>();

export const bundledWords: WordSource = {
  async get(lang) {
    const hit = cache.get(lang);
    if (hit) return hit;
    const raw = bundled[lang];
    if (!raw) return undefined;
    const list: WordList = {
      answers: raw.answers,
      guessable: new Set([...raw.answers, ...raw.allowed]),
    };
    cache.set(lang, list);
    return list;
  },
};
