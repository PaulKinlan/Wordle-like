// WebMCP (an experiment): lets an AI agent in the browser play, through the
// same game as a person. The agent reads the board and submits guesses; every
// guess goes through the normal checks (word list, hard mode, the server), and
// the answer is only revealed once the game is over, as it is for a player.
// Does nothing in browsers without WebMCP (document.modelContext).
import type { Mark } from '../shared/game';

export interface AgentState {
  mode: 'daily' | 'unlimited';
  language: { code: string; name: string };
  puzzleNumber?: number;
  wordLength: number;
  maxGuesses: number;
  hardMode: boolean;
  status: 'playing' | 'won' | 'lost';
  rows: { guess: string; marks: Mark[] }[];
  answer?: string;
}

export interface AgentHost {
  state(): AgentState | null;
  /** Types and submits a word; resolves with an error message if it was refused. */
  guess(word: string): Promise<string | null>;
  newGame(mode: 'daily' | 'unlimited'): Promise<void>;
  /** For analytics: which tool an agent used. */
  used(tool: string): void;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  annotations?: { readOnlyHint?: boolean };
  execute(input: Record<string, unknown>): Promise<string>;
}

type ModelContext = {
  registerTool?: (tool: Tool) => unknown;
  provideContext?: (ctx: { tools: Tool[] }) => unknown;
};

const RULES = `Letterle is a word game. Guess the hidden word in a limited number of tries.
- Each guess must be a real word of the right length in the game's language (see get_game_state).
- After each guess, every letter gets a mark: "correct" (right letter, right place), "present" (in the word, elsewhere), or "absent" (not in the word, or not as many times as you used it).
- In hard mode, every hint you've found must be used in later guesses: correct letters stay in place, present letters must appear.
- Daily mode has one word per day for everyone; unlimited mode gives a new word each game.
- Accents are optional: type letters without accents unless the language treats them as separate letters.`;

/** Correct, present and absent letters so far, the way the on-screen tracker shows them. */
function letterHints(rows: AgentState['rows']) {
  const best = new Map<string, Mark>();
  const rank: Record<Mark, number> = { absent: 0, present: 1, correct: 2 };
  for (const r of rows) {
    [...r.guess].forEach((ch, i) => {
      const m = r.marks[i];
      if (!best.has(ch) || rank[m] > rank[best.get(ch)!]) best.set(ch, m);
    });
  }
  const pick = (m: Mark) => [...best].filter(([, v]) => v === m).map(([k]) => k);
  return { correct: pick('correct'), present: pick('present'), absent: pick('absent') };
}

function describe(s: AgentState | null) {
  if (!s) return JSON.stringify({ status: 'loading' });
  return JSON.stringify({
    ...s,
    guessesLeft: s.maxGuesses - s.rows.length,
    letters: letterHints(s.rows),
  });
}

export function registerAgentTools(host: AgentHost) {
  const mc =
    (document as Document & { modelContext?: ModelContext }).modelContext ??
    (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  if (!mc) return;

  const tools: Tool[] = [
    {
      name: 'get_rules',
      description: 'How to play Letterle: what the colour marks mean, hard mode, and the game modes.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        host.used('get_rules');
        return RULES;
      },
    },
    {
      name: 'get_game_state',
      description:
        'The current game: mode, word language, word length, guesses so far with their marks, which letters are correct, present or absent, and how many guesses are left. The answer is only included once the game is over.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        host.used('get_game_state');
        return describe(host.state());
      },
    },
    {
      name: 'guess_word',
      description:
        'Submit a guess in the current game. Returns the marks for every guess so far and the game status, or why the guess was refused (not a word, wrong length, hard mode rule). The word is typed onto the board so the person can watch.',
      inputSchema: {
        type: 'object',
        properties: { word: { type: 'string', description: 'The guess, in the game language, e.g. "crane"' } },
        required: ['word'],
      },
      execute: async (input) => {
        host.used('guess_word');
        const word = typeof input.word === 'string' ? input.word.trim() : '';
        if (!word) return 'Refused: give a word to guess.';
        const problem = await host.guess(word);
        return problem ? `Refused: ${problem}\n${describe(host.state())}` : describe(host.state());
      },
    },
    {
      name: 'new_game',
      description:
        "Switch game: 'daily' opens today's word (or the daily game in progress); 'unlimited' continues the unlimited game in progress, or starts a new random word if the last one is over.",
      inputSchema: {
        type: 'object',
        properties: { mode: { type: 'string', enum: ['daily', 'unlimited'] } },
        required: ['mode'],
      },
      execute: async (input) => {
        host.used('new_game');
        await host.newGame(input.mode === 'daily' ? 'daily' : 'unlimited');
        return describe(host.state());
      },
    },
  ];

  try {
    if (mc.registerTool) for (const tool of tools) void Promise.resolve(mc.registerTool(tool)).catch(() => undefined);
    else mc.provideContext?.({ tools });
  } catch {
    /* an older or different version of the API */
  }
}
