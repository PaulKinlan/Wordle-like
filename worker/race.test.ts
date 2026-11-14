import { describe, expect, it } from 'vitest';
import { rank, rowPoints } from '../shared/race';
import { Race, RaceError } from './race';

const WORDS = new Set(['crane', 'slate', 'apple', 'world', 'water', 'fuzzy', 'tears']);
const make = (answer = 'water', hard = false) => {
  const race = new Race(
    Race.create({ code: 'ABCDEF', lang: 'en', hard, wordLength: 5, maxGuesses: 6 }, 0),
    (w) => WORDS.has(w),
  );
  const a = race.join('Ann', undefined, 0);
  const b = race.join('Bob', undefined, 0);
  race.start(a.id, answer, 1000, () => true);
  return { race, a, b };
};

describe('race scoring', () => {
  it('gives 2 points per green and 1 per yellow', () => {
    expect(rowPoints(['correct', 'present', 'absent', 'correct', 'present'])).toEqual({ points: 6, greens: 2, yellows: 2 });
  });

  it('ranks the solver first, then by best row, then by who got there first', () => {
    const row = (marks: string, at: number) => ({
      guess: 'xxxxx',
      marks: [...marks].map((c) => (c === 'g' ? 'correct' : c === 'y' ? 'present' : 'absent')) as any,
      at,
    });
    const s = rank([
      { id: 'a', name: 'A', rows: [row('gy...', 10)] },
      { id: 'b', name: 'B', rows: [row('gy...', 5)] },
      { id: 'c', name: 'C', rows: [row('ggg..', 20)] },
      { id: 'd', name: 'D', rows: [row('ggggg', 30)], solvedAt: 30 },
    ]);
    expect(s.map((x) => x.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(s[1]).toMatchObject({ points: 6, greens: 3, yellows: 0, bestRow: 1 });
  });
});

describe('race rules', () => {
  it('needs two players and only the host can start', () => {
    const race = new Race(Race.create({ code: 'X', lang: 'en', hard: false, wordLength: 5, maxGuesses: 6 }, 0), () => true);
    const a = race.join('Ann', undefined, 0);
    expect(() => race.start(a.id, 'water', 0, () => true)).toThrow(RaceError);
    const b = race.join('Bob', undefined, 0);
    expect(() => race.start(b.id, 'water', 0, () => true)).toThrow('Only the host');
    race.start(a.id, 'water', 0, () => true);
    expect(race.data.status).toBe('playing');
  });

  it('lets a player rejoin with their token, and caps the room', () => {
    const { race, a } = make();
    expect(race.join('Annie', a.token, 5).id).toBe(a.id);
    race.join('C', undefined, 0);
    race.join('D', undefined, 0);
    expect(() => race.join('E', undefined, 0)).toThrow('full');
  });

  it('starts a 5 second clock for the others when someone finishes a row', () => {
    const { race, a, b } = make();
    race.guess(a.id, 'crane', 2000);
    expect(race.deadline(b)).toBe(7000);
    expect(race.deadline(a)).toBeUndefined();
    expect(race.nextDeadline()).toBe(7000);
    expect(race.tick(6999)).toBe(false);
    expect(race.tick(7000)).toBe(true);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0].guess).toBeNull();
    // Bob is now on row 2. Ann hasn't done row 2, so no clock yet.
    expect(race.deadline(b)).toBeUndefined();
  });

  it('gives a player who falls behind 5 seconds per row, not less', () => {
    const { race, a, b } = make();
    race.guess(a.id, 'crane', 2000);
    race.guess(a.id, 'slate', 2500);
    race.guess(a.id, 'apple', 3000);
    expect(race.deadline(b)).toBe(7000);
    race.guess(b.id, 'world', 6000);
    // Row 2 was done by Ann at 2500, but Bob only got to it at 6000.
    expect(race.deadline(b)).toBe(11000);
  });

  it('ends as soon as someone finds the word', () => {
    const { race, a, b } = make();
    race.guess(a.id, 'crane', 2000);
    race.guess(b.id, 'water', 3000);
    expect(race.data.status).toBe('finished');
    const view = race.view(a.id, 3000, () => true);
    expect(view.result).toMatchObject({ answer: 'water', winnerId: b.id });
    expect(view.result!.standings[0].id).toBe(b.id);
    expect(() => race.guess(a.id, 'slate', 3100)).toThrow('not running');
  });

  it('scores the best row when nobody finds the word', () => {
    const { race, a, b } = make('water');
    for (let i = 0; i < 6; i++) race.guess(a.id, 'tears', 2000 + i); // t,e,a,r yellow/green
    race.tick(100_000); // Bob loses every row
    expect(race.data.status).toBe('finished');
    const result = race.view(b.id, 100_000, () => true).result!;
    expect(result.winnerId).toBe(a.id);
    expect(result.standings.map((s) => s.points)).toEqual([rowPoints(a.rows[0].marks).points, 0]);
    expect(result.standings[1].bestRow).toBe(0);
  });

  it('never shows other players letters, only colours', () => {
    const { race, a, b } = make();
    race.guess(a.id, 'crane', 2000);
    const bobView = race.view(b.id, 2000, () => true);
    expect(JSON.stringify(bobView)).not.toContain('crane');
    expect(bobView.players.find((p) => p.id === a.id)!.rows[0].marks).toHaveLength(5);
    expect(race.view(a.id, 2000, () => true).mine[0].guess).toBe('crane');
    expect(JSON.stringify(bobView)).not.toContain('water');
  });

  it('checks the word list and hard mode', () => {
    const { race, a } = make('water', true);
    expect(() => race.guess(a.id, 'zzzzz', 2000)).toThrow('Not in word list');
    race.guess(a.id, 'world', 2000); // w is green
    expect(() => race.guess(a.id, 'crane', 2100)).toThrow('Letter 1 must be W');
  });

  it('lets late joiners play from the next round', () => {
    const { race, a } = make();
    const c = race.join('Cat', undefined, 1500);
    expect(c.inRound).toBe(false);
    expect(() => race.guess(c.id, 'crane', 1600)).toThrow('next round');
    race.guess(a.id, 'water', 2000);
    race.start(a.id, 'slate', 3000, () => true);
    expect(c.inRound).toBe(true);
    expect(race.data.round).toBe(2);
  });
});

describe('hosts, seats and leaving', () => {
  const lobby = () => {
    const race = new Race(Race.create({ code: 'ABCDEF', lang: 'en', hard: false, wordLength: 5, maxGuesses: 6 }, 0), (w) => WORDS.has(w));
    const a = race.join('Ann', undefined, 0);
    const b = race.join('Bob', undefined, 0);
    const c = race.join('Cat', undefined, 0);
    return { race, a, b, c };
  };
  const only = (...ids: string[]) => (id: string) => ids.includes(id);

  it('hands the host role to the longest-waiting player when the host is away', () => {
    const { race, a, b, c } = lobby();
    expect(race.host(() => true)).toBe(a.id);
    expect(race.host(only(b.id, c.id))).toBe(b.id);
    expect(race.view(c.id, 0, only(b.id, c.id)).hostId).toBe(b.id);
    expect(() => race.start(c.id, 'water', 1, only(b.id, c.id))).toThrow(RaceError);
    race.start(b.id, 'water', 1, only(b.id, c.id));
    // Whoever started the round keeps the role, even if the first host comes back.
    expect(race.host(() => true)).toBe(b.id);
  });

  it('keeps the host while they are connected, and during a round', () => {
    const { race, a, b } = lobby();
    race.start(a.id, 'water', 1, () => true);
    expect(race.host(only(b.id))).toBe(a.id);
  });

  it('only lets the host cancel', () => {
    const { race, a, b } = lobby();
    expect(() => race.canCancel(b.id, () => true)).toThrow(RaceError);
    expect(() => race.canCancel(a.id, () => true)).not.toThrow();
    expect(() => race.canCancel(b.id, only(b.id))).not.toThrow();
  });

  it('frees the seat of a player who leaves, but not in the middle of their round', () => {
    const { race, a, b, c } = lobby();
    expect(race.leave(c.id, 5)).toBe(true);
    expect(race.data.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    race.start(a.id, 'water', 10, () => true);
    expect(race.leave(b.id, 11)).toBe(false);
    expect(race.data.players).toHaveLength(2);
  });

  it('passes the host role on when the host leaves', () => {
    const { race, a, b } = lobby();
    race.leave(a.id, 5);
    expect(race.data.hostId).toBe(b.id);
  });

  it('gives a full room\'s seat to a newcomer only if someone has gone away', () => {
    const { race, a, b, c } = lobby();
    const d = race.join('Dan', undefined, 0);
    expect(() => race.join('Eve', undefined, 1, () => true)).toThrow(RaceError);
    const e = race.join('Eve', undefined, 1, only(a.id, b.id, d.id));
    expect(race.data.players.map((p) => p.id)).toEqual([a.id, b.id, d.id, e.id]);
    expect(race.data.players.some((p) => p.id === c.id)).toBe(false);
  });

  it('never gives away the seat of someone playing the current round', () => {
    const { race, a, b, c } = lobby();
    race.join('Dan', undefined, 0);
    race.start(a.id, 'water', 1, () => true);
    // Everyone is in the round; Cat's connection drops, but her rows still count.
    expect(() => race.join('Eve', undefined, 2, only(a.id, b.id))).toThrow(RaceError);
    expect(race.data.players.some((p) => p.id === c.id)).toBe(true);
  });
});

