// Builds the English word lists that the Worker serves.
//
//   node scripts/build-wordlists.mjs
//
// Source: SCOWL via the `wordlist-english` package (permissive licence, see
// worker/words/en/LICENSE). Output is committed so builds are reproducible.
//
// - answers.json: common five-letter words (SCOWL levels 10-35), with simple
//   plurals, past tenses and a small blocklist removed. These can be the
//   daily or unlimited answer.
// - allowed.json: every five-letter word we accept as a guess (levels 10-70,
//   American + British + Canadian spellings). Answers are always allowed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = dirname(require.resolve('wordlist-english/package.json'));
const LEN = 5;
const re = new RegExp(`^[a-z]{${LEN}}$`);

const load = (variant, level) =>
  JSON.parse(readFileSync(join(pkgDir, `${variant}-words-${level}.json`), 'utf8'));

const levels = [10, 20, 35, 40, 50, 55, 60, 70];
const all = new Set();
for (const variant of ['english', 'american', 'british', 'canadian']) {
  for (const l of levels) for (const w of load(variant, l)) all.add(w);
}

const common = new Set();
for (const l of [10, 20, 35]) for (const w of load('english', l)) if (re.test(w)) common.add(w);

// Words that would be a poor or unkind daily answer.
const blocklist = new Set(
  'bitch bitty boobs booby butts crack dicks dildo dyked dykes faggy fagot gooks hoes homos horny jizzy kikes lesbo nazis negro niggr penis porno pussy queer rapes raped rapey sluts slutty spick spics titty turds twats vulva whore wanks'.split(
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
const allowed = [...all].filter((w) => re.test(w) && !answers.includes(w)).sort();

const out = join(root, 'worker/words/en');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'answers.json'), JSON.stringify(answers) + '\n');
writeFileSync(join(out, 'allowed.json'), JSON.stringify(allowed) + '\n');
writeFileSync(
  join(out, 'LICENSE'),
  readFileSync(join(pkgDir, 'Copyright'), 'utf8'),
);
console.log(`en: ${answers.length} answers, ${allowed.length} extra allowed guesses`);
