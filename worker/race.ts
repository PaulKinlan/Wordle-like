// The state of one race room, without any Cloudflare APIs, so it can be
// tested directly. worker/room.ts wraps it in a Durable Object.
import type { RaceAlert } from './push';
import { checkHardMode, describeViolation, evaluate, normalizeWord, type Mark } from '../shared/game';
import {
  cleanName,
  MAX_PLAYERS,
  rank,
  ROW_SECONDS,
  type RaceRow,
  type RaceState,
  type RaceStatus,
} from '../shared/race';

export interface RacePlayer {
  id: string;
  /** Secret that lets this player reconnect as themselves. */
  token: string;
  name: string;
  joinedAt: number;
  inRound: boolean;
  rows: RaceRow[];
  /** When this player was ready to start their current row. */
  readyAt: number;
  solvedAt?: number;
  /** Push subscription for "a friend joined" alerts; never sent to other players. */
  alert?: RaceAlert;
}

export interface RaceData {
  code: string;
  lang: string;
  hard: boolean;
  wordLength: number;
  maxGuesses: number;
  status: RaceStatus;
  round: number;
  hostId: string;
  /** Accented form, for display. */
  answer: string;
  players: RacePlayer[];
  /** firstDone[k]: when the first player finished row k this round. */
  firstDone: number[];
  winnerId?: string;
  lastActivity: number;
}

export class RaceError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const ROW_MS = ROW_SECONDS * 1000;

const randomId = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

export class Race {
  constructor(
    public data: RaceData,
    private isWord: (folded: string) => boolean,
  ) {}

  static create(
    opts: { code: string; lang: string; hard: boolean; wordLength: number; maxGuesses: number },
    now: number,
  ): RaceData {
    return { ...opts, status: 'lobby', round: 0, hostId: '', answer: '', players: [], firstDone: [], lastActivity: now };
  }

  private player(id: string) {
    return this.data.players.find((p) => p.id === id);
  }

  /** Joins, or rejoins with a token. Returns the player's id and token. */
  join(name: unknown, token: unknown, now: number): RacePlayer {
    const d = this.data;
    d.lastActivity = now;
    const existing = typeof token === 'string' ? d.players.find((p) => p.token === token) : undefined;
    if (existing) {
      existing.name = cleanName(name ?? existing.name);
      return existing;
    }
    if (d.players.length >= MAX_PLAYERS) throw new RaceError('room_full', `This race is full (${MAX_PLAYERS} players)`);
    const p: RacePlayer = {
      id: randomId(6),
      token: randomId(16),
      name: cleanName(name),
      joinedAt: now,
      inRound: d.status === 'lobby',
      rows: [],
      readyAt: now,
    };
    d.players.push(p);
    if (!d.hostId) d.hostId = p.id;
    return p;
  }

  /** The host starts a round (or the next one) with a new answer. */
  start(by: string, answer: string, now: number, connected: (id: string) => boolean) {
    const d = this.data;
    if (by !== d.hostId) throw new RaceError('not_host', 'Only the host can start');
    if (d.status === 'playing') throw new RaceError('in_progress', 'The race has already started');
    const players = d.players.filter((p) => connected(p.id));
    if (players.length < 2) throw new RaceError('need_players', 'Wait for a friend to join');
    d.status = 'playing';
    d.round++;
    d.answer = answer;
    d.firstDone = [];
    d.winnerId = undefined;
    d.lastActivity = now;
    for (const p of d.players) {
      p.inRound = players.includes(p);
      p.rows = [];
      p.readyAt = now;
      p.solvedAt = undefined;
    }
  }

  guess(id: string, word: unknown, now: number): void {
    const d = this.data;
    const p = this.player(id);
    if (d.status !== 'playing') throw new RaceError('not_playing', 'The race is not running');
    if (!p?.inRound) throw new RaceError('not_in_round', "You'll join the next round");
    this.tick(now); // a row may have just run out
    if (this.data.status !== 'playing') return;
    if (this.isDone(p)) throw new RaceError('done', 'You have no rows left');
    const guess = typeof word === 'string' ? normalizeWord(word, d.lang) : '';
    if ([...guess].length !== d.wordLength) throw new RaceError('wrong_length', `Guesses must be ${d.wordLength} letters`);
    if (!this.isWord(guess)) throw new RaceError('not_in_list', 'Not in word list');
    if (d.hard) {
      const v = checkHardMode(
        p.rows.filter((r): r is RaceRow & { guess: string } => r.guess !== null),
        guess,
      );
      if (v) throw new RaceError('hard_mode', describeViolation(v));
    }
    const marks = evaluate(guess, normalizeWord(d.answer, d.lang));
    const k = p.rows.length;
    p.rows.push({ guess, marks, at: now });
    p.readyAt = now;
    d.lastActivity = now;
    if (d.firstDone[k] === undefined) d.firstDone[k] = now;
    if (marks.every((m) => m === 'correct')) {
      p.solvedAt = now;
      d.winnerId ??= p.id;
      d.status = 'finished';
      return;
    }
    this.checkEnd();
  }

  private isDone(p: RacePlayer) {
    return p.solvedAt !== undefined || p.rows.length >= this.data.maxGuesses;
  }

  /** When this player's current row runs out, if someone else has finished it. */
  deadline(p: RacePlayer): number | undefined {
    const d = this.data;
    if (d.status !== 'playing' || !p.inRound || this.isDone(p)) return undefined;
    const first = d.firstDone[p.rows.length];
    if (first === undefined) return undefined;
    return Math.max(first, p.readyAt) + ROW_MS;
  }

  /** Loses any rows whose time has run out. Returns true if anything changed. */
  tick(now: number): boolean {
    const d = this.data;
    if (d.status !== 'playing') return false;
    let changed = false;
    for (let again = true; again && d.status === 'playing'; ) {
      again = false;
      for (const p of d.players) {
        const due = this.deadline(p);
        if (due !== undefined && due <= now) {
          p.rows.push({ guess: null, marks: Array<Mark>(d.wordLength).fill('absent'), at: due });
          p.readyAt = due;
          again = changed = true;
        }
      }
      if (changed) this.checkEnd();
    }
    return changed;
  }

  private checkEnd() {
    const d = this.data;
    if (d.players.filter((p) => p.inRound).every((p) => this.isDone(p))) d.status = 'finished';
  }

  /** The next time tick() needs to run, if any. */
  nextDeadline(): number | undefined {
    const times = this.data.players.map((p) => this.deadline(p)).filter((t): t is number => t !== undefined);
    return times.length ? Math.min(...times) : undefined;
  }

  /** The winner found the word first; otherwise the best row on points wins. */
  private result() {
    const d = this.data;
    const standings = rank(d.players.filter((p) => p.inRound));
    const top = standings[0];
    const winnerId = d.winnerId ?? (top && top.points > 0 ? top.id : undefined);
    return { answer: d.answer, winnerId, standings };
  }

  /** The room as one player sees it. */
  view(id: string | undefined, now: number, connected: (id: string) => boolean): RaceState {
    const d = this.data;
    const me = id ? this.player(id) : undefined;
    const finished = d.status === 'finished';
    return {
      code: d.code,
      lang: d.lang,
      hard: d.hard,
      wordLength: d.wordLength,
      maxGuesses: d.maxGuesses,
      status: d.status,
      round: d.round,
      hostId: d.hostId,
      players: d.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: connected(p.id),
        inRound: p.inRound,
        rows: p.rows.map((r) => ({ marks: r.marks, lost: r.guess === null })),
        solved: p.solvedAt !== undefined,
        deadline: this.deadline(p),
      })),
      mine: me?.inRound ? me.rows.map((r) => ({ guess: r.guess, marks: r.marks })) : [],
      result: finished && d.round > 0 ? this.result() : undefined,
      now,
    };
  }
}
