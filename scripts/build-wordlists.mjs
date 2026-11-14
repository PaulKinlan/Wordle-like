// Builds the word lists that the Worker serves.
//
//   node scripts/build-wordlists.mjs          every language
//   node scripts/build-wordlists.mjs es fr    just these
//
// English is described below. Other languages are at the end of this file.
//
// Source: SCOWL via the `wordlist-english` package (permissive licence, see
// worker/words/en/LICENSE). Output is committed so builds are reproducible.
//
// - candidates.json: common five-letter words (SCOWL levels 10-35), with
//   simple plurals, past tenses and a small blocklist removed. These are the
//   words that can be an answer. Which word is used on which day is decided
//   by a random shuffle the Worker makes once and keeps in D1, so it is never
//   in this repository (see worker/answers.ts).
// - rare.json: rarely used words (SCOWL levels 40-50), the hard mode answers.
// - allowed.json: every five-letter word we accept as a guess (levels 10-70,
//   American + British + Canadian spellings). Answers are always allowed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEN = 5;
const only = process.argv.slice(2);
const wanted = (code) => only.length === 0 || only.includes(code);

if (wanted('en')) buildEnglish();

function buildEnglish() {
  const pkgDir = dirname(require.resolve('wordlist-english/package.json'));
  const re = new RegExp(`^[a-z]{${LEN}}$`);

  const load = (variant, level) => JSON.parse(readFileSync(join(pkgDir, `${variant}-words-${level}.json`), 'utf8'));

  const levels = [10, 20, 35, 40, 50, 55, 60, 70];
  const all = new Set();
  for (const variant of ['english', 'american', 'british', 'canadian']) {
    for (const l of levels) for (const w of load(variant, l)) all.add(w);
  }

  const common = new Set();
  for (const l of [10, 20, 35]) for (const w of load('english', l)) if (re.test(w)) common.add(w);

  // Words that would be a poor or unkind daily answer.
  const blocklist = new Set(
    'bitch bitty boobs booby butts crack dicks dildo dyked dykes faggy fagot gooks hoes homos horny jizzy kikes lesbo nazis negro niggr penis porno pussy queer rapes raped rapey sluts slutty spick spics titty turds twats vulva whore wanks butch homer roger sonny noway'.split(
      ' ',
    ),
  );

  const isInflection = (w) => {
    // plurals and third-person verbs: "cards" (card), "boxes" (box), "flies" (fly)
    if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) {
      if (all.has(w.slice(0, -1))) return true;
      if (w.endsWith('es') && all.has(w.slice(0, -2))) return true;
      if (w.endsWith('ies') && all.has(w.slice(0, -3) + 'y')) return true;
    }
    // past tenses: "baked" (bake), "aimed" (aim), "tried" (try), "stopped"-style is >5
    if (w.endsWith('ed')) {
      if (all.has(w.slice(0, -1)) || all.has(w.slice(0, -2))) return true;
      if (w.endsWith('ied') && all.has(w.slice(0, -3) + 'y')) return true;
      if (w[2] === w[3] && all.has(w.slice(0, 3))) return true;
    }
    return false;
  };

  const answers = [...common].filter((w) => !blocklist.has(w) && !isInflection(w)).sort();

  // Hard mode answers: real but rarely used words (SCOWL levels 40-50, which
  // rank below the common levels by frequency), with the same filters.
  const rareSet = new Set();
  for (const l of [40, 50]) for (const w of load('english', l)) if (re.test(w)) rareSet.add(w);
  const rare = [...rareSet].filter((w) => !common.has(w) && !blocklist.has(w) && !isInflection(w)).sort();

  const allowed = [...all].filter((w) => re.test(w) && !answers.includes(w)).sort();

  const out = join(root, 'worker/words/en');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'candidates.json'), JSON.stringify(answers) + '\n');
  writeFileSync(join(out, 'rare.json'), JSON.stringify(rare) + '\n');
  writeFileSync(join(out, 'allowed.json'), JSON.stringify(allowed) + '\n');
  writeFileSync(join(out, 'LICENSE'), readFileSync(join(pkgDir, 'Copyright'), 'utf8'));
  console.log(
    `en: ${answers.length} candidate answers, ${rare.length} rare (hard mode), ${allowed.length} extra allowed guesses`,
  );
}

// ------------------------------------------------------------------ other languages
//
// Two sources, combined:
// - How common a word is: the FrequencyWords lists by Hermit Dave, counted
//   from OpenSubtitles (content CC BY-SA 4.0). Downloaded on demand into
//   node_modules/.cache, never committed.
// - Whether it's a real word: the Hunspell dictionaries from wooorm/dictionaries
//   (the dictionary-xx dev dependencies), checked with nspell.
//
// - candidates.json: the most common words that are dictionary headwords (so
//   mostly base forms, not every conjugation), written with their accents.
//   Answers are compared without folded accents (see normalizeWord), and
//   the accented spelling is what's shown when the game ends.
// - rare.json: less common headwords, the hard mode answers.
// - allowed.json: every other accepted guess, already folded (no accents
//   except letters that are their own letter, like Spanish ñ or German ä).
//
// Per-language tweaks live in INTL below.

const INTL = {
  es: {
    alphabet: 'abcdefghijklmnñopqrstuvwxyz',
    answers: 1800,
    // Verb + pronoun forms like "úsame" or "ámala" are poor answers.
    skip: (w) => /^[^aeiouáéíóú]*[áéíóú].*(me|te|se|la|lo|le|nos)$/.test(w),
  },
  fr: { alphabet: 'abcdefghijklmnopqrstuvwxyz', answers: 1800 },
  de: {
    alphabet: 'aäbcdefghijklmnoöpqrsßtuüvwxyz',
    answers: 1600,
    // Nouns are capitalised. In this dictionary, nouns carry inflection flags
    // in lowercase (Stadt/ijm), while names and brands don't (Leica/S).
    // Flag "Z" alone marks split verb forms like "zuzog".
    headword: (word, flags) => (/^\p{Lu}/u.test(word) ? /[a-z]/.test(flags) : flags !== 'Z'),
  },
  // nspell takes many minutes to load the Italian and Portuguese dictionaries,
  // so for them a guess is valid if it's a headword or common enough in the
  // frequency list (seen at least `spellFreeCount` times).
  it: { alphabet: 'abcdefghijklmnopqrstuvwxyz', answers: 1400, spellFreeCount: 20 },
  pt: { alphabet: 'abcdefghijklmnopqrstuvwxyz', answers: 1800, spellFreeCount: 20 },
  nl: { alphabet: 'abcdefghijklmnopqrstuvwxyz', answers: 1800 },
  // Added November 2026. Keep the alphabets in step with shared/languages.ts.
  // nspell is too slow on these dictionaries too, so they use spellFreeCount.
  ca: { spellFreeCount: 20, alphabet: 'abcçdefghijklmnopqrstuvwxyz', answers: 1400 },
  eu: { spellFreeCount: 20, alphabet: 'abcdefghijklmnñopqrstuvwxyz', answers: 1200 },
  // Breton subtitles are scarce, so top up with dictionary headwords.
  br: { spellFreeCount: 20, alphabet: 'abcdefghijklmnñopqrstuvwxyz', answers: 800, fillFromHeadwords: true },
  pl: { spellFreeCount: 20, alphabet: 'aąbcćdeęfghijklłmnńoópqrsśtuvwxyzźż', answers: 1600 },
  sv: { spellFreeCount: 20, alphabet: 'abcdefghijklmnopqrstuvwxyzåäö', answers: 1600 },
  tr: { spellFreeCount: 20, alphabet: 'abcçdefgğhıijklmnoöprsştuüvyz', answers: 1600 },
  // No subtitle counts for these: Irish uses a cleaned lemma frequency list
  // (michmech/irish-word-frequency, ODbL), Gaelic the words of a Universal
  // Dependencies treebank (ARCOSG). Both are small, so dictionary headwords
  // top up the answers.
  ga: {
    spellFreeCount: 3,
    alphabet: 'abcdefghijklmnopqrstuvwxyz',
    answers: 900,
    fillFromHeadwords: true,
    freq: { url: 'https://raw.githubusercontent.com/michmech/irish-word-frequency/master/frequency.txt', format: 'michmech', credit: 'Irish Word Frequency List by Michal Boleslav Měchura (https://github.com/michmech/irish-word-frequency), Open Database License.' },
  },
  gd: {
    spellFreeCount: 3,
    alphabet: 'abcdefghijklmnopqrstuvwxyz',
    answers: 900,
    fillFromHeadwords: true,
    freq: {
      url: [
        'https://raw.githubusercontent.com/UniversalDependencies/UD_Scottish_Gaelic-ARCOSG/master/gd_arcosg-ud-train.conllu',
        'https://raw.githubusercontent.com/UniversalDependencies/UD_Scottish_Gaelic-ARCOSG/master/gd_arcosg-ud-dev.conllu',
        'https://raw.githubusercontent.com/UniversalDependencies/UD_Scottish_Gaelic-ARCOSG/master/gd_arcosg-ud-test.conllu',
      ],
      format: 'conllu',
      credit: 'UD Scottish Gaelic ARCOSG treebank (https://github.com/UniversalDependencies/UD_Scottish_Gaelic-ARCOSG), CC BY-SA 4.0.',
    },
  },
  // Welsh: ch, dd, ff, ng, ll, ph, rh and th are single letters, one tile each,
  // so a five-tile word can be longer than five letters ("cyllell" is c·y·ll·e·ll).
  // Inside the game each is a private-use character (shared/languages.ts).
  cy: {
    spellFreeCount: 3,
    alphabet: 'abcdefghijlmnoprstuwy',
    digraphs: ['ch', 'dd', 'ff', 'ng', 'll', 'ph', 'rh', 'th'],
    answers: 900,
    fillFromHeadwords: true,
    freq: {
      url: ['train', 'dev', 'test'].map(
        (part) => `https://raw.githubusercontent.com/UniversalDependencies/UD_Welsh-CCG/master/cy_ccg-ud-${part}.conllu`,
      ),
      format: 'conllu',
      credit: 'UD Welsh CCG treebank (https://github.com/UniversalDependencies/UD_Welsh-CCG), CC BY-SA 4.0.',
    },
  },
  el: { spellFreeCount: 20, alphabet: 'αβγδεζηθικλμνξοπρστυφχψω', fold: { ς: 'σ' }, answers: 1400 },
};

const FREQ_URL = (code) =>
  `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/${code}/${code}_full.txt`;

// Words to never use as an answer (they stay valid guesses).
const INTL_BLOCK = new Set(
  'porno pornô chier pisse culos puta putas puto putos joder coños polla pollas mierda culos negro negra maricón marica zorra pute putes salop bites niquer merde nègre pédé gouine fotze ficke ficken hure huren arsch neger schwul nutte cazzo cazzi troia negri froci frocio merda porra caralho buceta piroca viado negro bicha kanker hoer hoeren lul lullen neger flikker kut kutje'.split(
    ' ',
  ),
);

for (const [code, cfg] of Object.entries(INTL)) if (wanted(code)) await buildIntl(code, cfg);

function englishWords() {
  const dir = dirname(require.resolve('wordlist-english/package.json'));
  const out = new Set();
  for (const l of [10, 20, 35, 40, 50, 55, 60, 70]) for (const w of JSON.parse(readFileSync(join(dir, `english-words-${l}.json`), 'utf8'))) out.add(w);
  return out;
}

/** [word, count] pairs, most common first, downloaded once into node_modules/.cache. */
async function frequencies(code, freq) {
  const cacheDir = join(root, 'node_modules/.cache/wordlists');
  mkdirSync(cacheDir, { recursive: true });
  const urls = freq ? [freq.url].flat() : [FREQ_URL(code)];
  let text = '';
  for (const [i, url] of urls.entries()) {
    const path = join(cacheDir, `${code}_${i}.txt`);
    if (!existsSync(path)) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed for ${code}: ${res.status} ${url}`);
      writeFileSync(path, await res.text());
    }
    text += readFileSync(path, 'utf8') + '\n';
  }
  const format = freq?.format ?? 'hermitdave';
  if (format === 'hermitdave') return text.split('\n').map((l) => l.trim().split(' ')).map(([w, c]) => [w, Number(c)]);
  if (format === 'michmech') {
    // rank <tab> lemma <tab> frequency ...
    return text
      .split(/\r?\n/)
      .filter((l) => /^\d/.test(l))
      .map((l) => l.split('\t'))
      .map(([, w, c]) => [w, Number(c)]);
  }
  // CoNLL-U: count the word forms (column 2) of every sentence.
  const counts = new Map();
  for (const l of text.split('\n')) {
    if (!l || l.startsWith('#')) continue;
    const cols = l.split('\t');
    if (cols.length < 2 || !/^\d+$/.test(cols[0])) continue;
    const w = cols[1].toLocaleLowerCase(code);
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

async function buildIntl(code, cfg) {
  let correct;
  if (cfg.spellFreeCount) {
    correct = (word, count) => headwords.has(word) || count >= cfg.spellFreeCount;
  } else {
    const { default: nspell } = await import('nspell');
    const { default: dict } = await import(`dictionary-${code}`);
    const spell = nspell(dict);
    correct = (word) => spell.correct(word) || spell.correct(word[0].toLocaleUpperCase(code) + word.slice(1));
  }
  // Must match DIGRAPHS in shared/languages.ts.
  const DIGRAPHS = ['ch', 'dd', 'ff', 'ng', 'll', 'ph', 'rh', 'th'];
  const joinDigraphs = (w) => {
    if (!cfg.digraphs) return w;
    let out = '';
    for (let i = 0; i < w.length; i++) {
      const pair = w.slice(i, i + 2);
      if (cfg.digraphs.includes(pair)) {
        out += String.fromCharCode(0xe000 + DIGRAPHS.indexOf(pair));
        i++;
      } else out += w[i];
    }
    return out;
  };
  const alphabet = new Set(cfg.alphabet);
  const fold = (w) => {
    let out = '';
    for (let ch of w.normalize('NFC').toLocaleLowerCase(code)) {
      ch = cfg.fold?.[ch] ?? ch;
      if (alphabet.has(ch)) out += ch;
      else {
        const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
        if (base.length !== 1 || !alphabet.has(base)) return null;
        out += base;
      }
    }
    out = joinDigraphs(out);
    return [...out].length === LEN ? out : null;
  };

  // Headwords in the Hunspell dictionary, with their flags.
  const dicPath = join(dirname(require.resolve(`dictionary-${code}`)), 'index.dic');
  const headwords = new Map();
  for (const line of readFileSync(dicPath, 'utf8').split('\n').slice(1)) {
    const [word, flags = ''] = line.trim().split(/\s/)[0].split('/');
    if ((!cfg.digraphs && [...word].length !== LEN) || !/^\p{L}+$/u.test(word)) continue;
    if (!(cfg.headword ?? ((w) => w === w.toLocaleLowerCase(code)))(word, flags)) continue;
    headwords.set(word.toLocaleLowerCase(code), word);
  }

  const lines = await frequencies(code, cfg.freq);

  const answers = [];
  const rare = [];
  const guessable = new Set();
  const used = new Set();
  for (const [word, count] of lines) {
    if (!word || Number(count) < 3) continue;
    if ((!cfg.digraphs && [...word].length !== LEN) || !/^\p{L}+$/u.test(word)) continue;
    const folded = fold(word);
    if (!folded) continue;
    if (!correct(word, Number(count))) continue;
    guessable.add(folded);
    if (!headwords.has(word) || used.has(folded)) continue;
    if (INTL_BLOCK.has(word) || INTL_BLOCK.has(folded) || cfg.skip?.(word)) continue;
    used.add(folded);
    (answers.length < cfg.answers ? answers : rare).push(word);
  }
  if (cfg.fillFromHeadwords) {
    // The dictionaries carry English loanwords ("ackee", "adieu"): leave those out of the answers.
    const english = englishWords();
    // A fixed shuffle (by a hash of the word), so the extra answers aren't all from the start of the alphabet.
    const hash = (w) => [...w].reduce((h, c) => Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0, 2166136261);
    const shuffled = [...headwords].sort((a, b) => hash(a[0]) - hash(b[0]));
    for (const [lower, word] of shuffled) {
      const folded = fold(lower);
      if (!folded || used.has(folded) || INTL_BLOCK.has(lower) || english.has(lower)) continue;
      used.add(folded);
      if (answers.length < cfg.answers) answers.push(word);
      else if (rare.length < 2000) rare.push(word);
    }
  }
  // Every headword is a fine guess, even if it never came up in subtitles.
  for (const word of headwords.keys()) {
    const folded = fold(word);
    if (folded) guessable.add(folded);
  }

  const answerKeys = new Set([...answers, ...rare].map(fold));
  const allowed = [...guessable].filter((w) => !answerKeys.has(w)).sort();
  const out = join(root, 'worker/words', code);
  mkdirSync(out, { recursive: true });
  const sort = (list) => [...list].sort((a, b) => a.localeCompare(b, code));
  writeFileSync(join(out, 'candidates.json'), JSON.stringify(sort(answers)) + '\n');
  writeFileSync(join(out, 'rare.json'), JSON.stringify(sort(rare)) + '\n');
  writeFileSync(join(out, 'allowed.json'), JSON.stringify(allowed) + '\n');
  const pkg = JSON.parse(readFileSync(join(dirname(require.resolve(`dictionary-${code}`)), 'package.json'), 'utf8'));
  writeFileSync(
    join(out, 'LICENSE'),
    `Word lists for "${code}", built by scripts/build-wordlists.mjs from:

1. ${cfg.freq?.credit ?? 'FrequencyWords by Hermit Dave (https://github.com/hermitdave/FrequencyWords),\n   word frequencies counted from OpenSubtitles. Content licensed CC BY-SA 4.0.'}

2. The Hunspell dictionary in the npm package ${pkg.name}@${pkg.version}
   (https://github.com/wooorm/dictionaries), licensed ${pkg.license}.
   See that package for the full licence and its authors.

These lists are a derived selection of words and are distributed under the
same terms.
`,
  );
  console.log(
    `${code}: ${answers.length} candidate answers, ${rare.length} rare (hard mode), ${allowed.length} extra allowed guesses`,
  );
}
