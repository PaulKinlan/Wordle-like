// Word lists, keyed by language code. Bundled into the Worker.
//
// candidates: common words that can be an answer (order is private, see answers.ts)
// rare:       rarely used words, the answers in hard mode
// guessable:  every word accepted as a guess, both answer pools included
//
// Answers keep their accents ("árbol") so the real spelling can be shown when
// a game ends. Guesses are compared in folded form ("arbol"), see
// normalizeWord in shared/game.ts.
import { normalizeWord } from '../shared/game';
import deAllowed from './words/de/allowed.json';
import deCandidates from './words/de/candidates.json';
import deRare from './words/de/rare.json';
import enAllowed from './words/en/allowed.json';
import enCandidates from './words/en/candidates.json';
import enRare from './words/en/rare.json';
import esAllowed from './words/es/allowed.json';
import esCandidates from './words/es/candidates.json';
import esRare from './words/es/rare.json';
import frAllowed from './words/fr/allowed.json';
import frCandidates from './words/fr/candidates.json';
import frRare from './words/fr/rare.json';
import itAllowed from './words/it/allowed.json';
import itCandidates from './words/it/candidates.json';
import itRare from './words/it/rare.json';
import nlAllowed from './words/nl/allowed.json';
import nlCandidates from './words/nl/candidates.json';
import nlRare from './words/nl/rare.json';
import caAllowed from './words/ca/allowed.json';
import caCandidates from './words/ca/candidates.json';
import caRare from './words/ca/rare.json';
import euAllowed from './words/eu/allowed.json';
import euCandidates from './words/eu/candidates.json';
import euRare from './words/eu/rare.json';
import brAllowed from './words/br/allowed.json';
import brCandidates from './words/br/candidates.json';
import brRare from './words/br/rare.json';
import plAllowed from './words/pl/allowed.json';
import plCandidates from './words/pl/candidates.json';
import plRare from './words/pl/rare.json';
import svAllowed from './words/sv/allowed.json';
import svCandidates from './words/sv/candidates.json';
import svRare from './words/sv/rare.json';
import trAllowed from './words/tr/allowed.json';
import trCandidates from './words/tr/candidates.json';
import trRare from './words/tr/rare.json';
import elAllowed from './words/el/allowed.json';
import elCandidates from './words/el/candidates.json';
import elRare from './words/el/rare.json';
import gaAllowed from './words/ga/allowed.json';
import gaCandidates from './words/ga/candidates.json';
import gaRare from './words/ga/rare.json';
import gdAllowed from './words/gd/allowed.json';
import gdCandidates from './words/gd/candidates.json';
import gdRare from './words/gd/rare.json';
import cyAllowed from './words/cy/allowed.json';
import cyCandidates from './words/cy/candidates.json';
import cyRare from './words/cy/rare.json';
import ptAllowed from './words/pt/allowed.json';
import ptCandidates from './words/pt/candidates.json';
import ptRare from './words/pt/rare.json';

export interface WordList {
  candidates: readonly string[];
  rare: readonly string[];
  /** Folded forms of every accepted guess. */
  guessable: ReadonlySet<string>;
}

type Raw = { candidates: string[]; rare: string[]; allowed: string[] };

const bundled: Record<string, Raw> = {
  en: { candidates: enCandidates, rare: enRare, allowed: enAllowed },
  es: { candidates: esCandidates, rare: esRare, allowed: esAllowed },
  fr: { candidates: frCandidates, rare: frRare, allowed: frAllowed },
  de: { candidates: deCandidates, rare: deRare, allowed: deAllowed },
  it: { candidates: itCandidates, rare: itRare, allowed: itAllowed },
  pt: { candidates: ptCandidates, rare: ptRare, allowed: ptAllowed },
  nl: { candidates: nlCandidates, rare: nlRare, allowed: nlAllowed },
  ca: { candidates: caCandidates, rare: caRare, allowed: caAllowed },
  eu: { candidates: euCandidates, rare: euRare, allowed: euAllowed },
  br: { candidates: brCandidates, rare: brRare, allowed: brAllowed },
  pl: { candidates: plCandidates, rare: plRare, allowed: plAllowed },
  sv: { candidates: svCandidates, rare: svRare, allowed: svAllowed },
  tr: { candidates: trCandidates, rare: trRare, allowed: trAllowed },
  cy: { candidates: cyCandidates, rare: cyRare, allowed: cyAllowed },
  ga: { candidates: gaCandidates, rare: gaRare, allowed: gaAllowed },
  gd: { candidates: gdCandidates, rare: gdRare, allowed: gdAllowed },
  el: { candidates: elCandidates, rare: elRare, allowed: elAllowed },
};

const cache = new Map<string, WordList>();

export function getWords(lang: string): WordList | undefined {
  const hit = cache.get(lang);
  if (hit) return hit;
  const raw = bundled[lang];
  if (!raw) return undefined;
  const fold = (w: string) => normalizeWord(w, lang);
  const list: WordList = {
    candidates: raw.candidates,
    // A small language may have no rare words yet: hard mode then uses the common ones.
    rare: raw.rare.length ? raw.rare : raw.candidates,
    guessable: new Set([...raw.candidates.map(fold), ...raw.rare.map(fold), ...raw.allowed]),
  };
  cache.set(lang, list);
  return list;
}
