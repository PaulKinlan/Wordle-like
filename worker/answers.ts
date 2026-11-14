// The answer for each puzzle, kept private on the server.
//
// The repository only holds the *candidate* words (worker/words). The order
// they're used in is a random shuffle made by the Worker the first time a
// language is played, and stored in D1. Nobody can work out a day's word from
// the code, and there is no secret to configure.
//
//   daily puzzle N   -> row (N - 1) mod count
//   unlimited token  -> row (token mod count)

export interface AnswerStore {
  /**
   * Number of answers in a set ("en", or "en:rare" for hard mode),
   * shuffling the candidates in on first use.
   */
  count(set: string, candidates: readonly string[]): Promise<number>;
  /** The answer at a position in the set's private order. */
  at(set: string, index: number): Promise<string>;
}

const SAFE_WORD = /^\p{L}+$/u;

export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  const rand = new Uint32Array(out.length);
  crypto.getRandomValues(rand);
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand[i] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export class D1AnswerStore implements AnswerStore {
  private counts = new Map<string, number>();

  constructor(private db: D1Database) {}

  async count(lang: string, candidates: readonly string[]): Promise<number> {
    const cached = this.counts.get(lang);
    if (cached) return cached;
    let n = await this.readCount(lang);
    if (n === null) {
      await this.seed(lang, candidates);
      n = await this.readCount(lang);
    }
    if (!n) throw new Error(`No answers stored for ${lang}`);
    this.counts.set(lang, n);
    return n;
  }

  async at(lang: string, index: number): Promise<string> {
    const row = await this.db
      .prepare('SELECT word FROM answers WHERE lang = ?1 AND idx = ?2')
      .bind(lang, index)
      .first<{ word: string }>();
    if (!row) throw new Error(`Missing answer ${lang}/${index}`);
    return row.word;
  }

  private async readCount(lang: string): Promise<number | null> {
    try {
      const row = await this.db
        .prepare('SELECT count FROM answer_sets WHERE lang = ?1')
        .bind(lang)
        .first<{ count: number }>();
      return row?.count ?? null;
    } catch {
      return null; // tables not created yet
    }
  }

  /**
   * Creates the tables if needed and stores a fresh shuffle. Runs as one
   * transaction that starts by claiming the language in answer_sets, so if
   * two requests race, only one shuffle is ever kept.
   */
  private async seed(lang: string, candidates: readonly string[]) {
    await this.db.batch([
      this.db.prepare(
        'CREATE TABLE IF NOT EXISTS answer_sets (lang TEXT PRIMARY KEY, count INTEGER NOT NULL, created_at TEXT NOT NULL)',
      ),
      this.db.prepare(
        'CREATE TABLE IF NOT EXISTS answers (lang TEXT NOT NULL, idx INTEGER NOT NULL, word TEXT NOT NULL, PRIMARY KEY (lang, idx))',
      ),
    ]);
    const words = shuffle(candidates.filter((w) => SAFE_WORD.test(w)));
    const statements = [
      this.db
        .prepare('INSERT INTO answer_sets (lang, count, created_at) VALUES (?1, ?2, ?3)')
        .bind(lang, words.length, new Date().toISOString()),
    ];
    // D1 allows 100 bound parameters per query, so the rows are written as
    // literals. Every word has been checked to be letters only.
    const quotedLang = lang.replace(/[^a-z:-]/gi, '');
    for (let i = 0; i < words.length; i += 400) {
      const values = words
        .slice(i, i + 400)
        .map((w, j) => `('${quotedLang}', ${i + j}, '${w}')`)
        .join(',');
      statements.push(this.db.prepare(`INSERT INTO answers (lang, idx, word) VALUES ${values}`));
    }
    try {
      await this.db.batch(statements);
    } catch (e) {
      // Another request seeded first: fine, use theirs.
      if ((await this.readCount(lang)) === null) throw e;
    }
  }
}

/** In-memory store, for tests. */
export class MemoryAnswerStore implements AnswerStore {
  private lists = new Map<string, string[]>();
  constructor(private order: (c: readonly string[]) => string[] = shuffle) {}
  async count(lang: string, candidates: readonly string[]) {
    if (!this.lists.has(lang)) this.lists.set(lang, this.order(candidates));
    return this.lists.get(lang)!.length;
  }
  async at(lang: string, index: number) {
    return this.lists.get(lang)![index];
  }
}
