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
    return [...out].length === LEN ? out : null;
  };

  // Headwords in the Hunspell dictionary, with their flags.
  const dicPath = join(dirname(require.resolve(`dictionary-${code}`)), 'index.dic');
  const headwords = new Map();
  for (const line of readFileSync(dicPath, 'utf8').split('\n').slice(1)) {
    const [word, flags = ''] = line.trim().split(/\s/)[0].split('/');
    if ([...word].length !== LEN || !/^\p{L}+$/u.test(word)) continue;
    if (!(cfg.headword ?? ((w) => w === w.toLocaleLowerCase(code)))(word, flags)) continue;
    headwords.set(word.toLocaleLowerCase(code), word);
  }

  const cacheDir = join(root, 'node_modules/.cache/wordlists');
  mkdirSync(cacheDir, { recursive: true });
  const freqPath = join(cacheDir, `${code}_full.txt`);
  if (!existsSync(freqPath)) {
    const res = await fetch(FREQ_URL(code));
    if (!res.ok) throw new Error(`Download failed for ${code}: ${res.status}`);
    writeFileSync(freqPath, await res.text());
  }

  const answers = [];
  const rare = [];
  const guessable = new Set();
  const used = new Set();
  for (const line of readFileSync(freqPath, 'utf8').split('\n')) {
    const [word, count] = line.trim().split(' ');
    if (!word || Number(count) < 3) continue;
    if ([...word].length !== LEN || !/^\p{L}+$/u.test(word)) continue;
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
    for (const [lower, word] of headwords) {
      const folded = fold(lower);
      if (!folded || used.has(folded) || INTL_BLOCK.has(lower)) continue;
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

1. FrequencyWords by Hermit Dave (https://github.com/hermitdave/FrequencyWords),
   word frequencies counted from OpenSubtitles. Content licensed CC BY-SA 4.0.

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
