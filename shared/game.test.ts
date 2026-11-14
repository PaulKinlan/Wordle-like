import { describe, expect, it } from 'vitest';
import { checkHardMode, evaluate, normalizeWord, statusAfter } from './game';
import { orderLanguages } from './languages';

const m = (s: string) =>
  [...s].map((c) => (c === 'g' ? 'correct' : c === 'y' ? 'present' : 'absent'));

describe('evaluate', () => {
  it('marks exact, present and absent letters', () => {
    expect(evaluate('crane', 'react')).toEqual(m('yyg.y'));
    expect(evaluate('react', 'react')).toEqual(m('ggggg'));
  });
  it('does not over-count repeated letters in the guess', () => {
    expect(evaluate('speed', 'abide')).toEqual(m('..y.y'));
    expect(evaluate('eerie', 'there')).toEqual(m('y.y.g'));
    expect(evaluate('lllll', 'hello')).toEqual(m('..gg.'));
  });
  it('marks a repeated letter present only once when the answer has one', () => {
    expect(evaluate('allee', 'apple')).toEqual(m('gy..g'));
  });
});

describe('checkHardMode', () => {
  const prev = [{ guess: 'crane', marks: m('g.y..') }];
  it('requires greens to stay in place', () => {
    expect(checkHardMode(prev, 'bacon')).toEqual({ kind: 'position', letter: 'c', position: 0 });
  });
  it('requires yellows to be reused', () => {
    expect(checkHardMode(prev, 'cloud')).toEqual({ kind: 'include', letter: 'a', count: 1 });
    expect(checkHardMode(prev, 'chalk')).toBeNull();
  });
  it('counts repeated revealed letters', () => {
    const p = [{ guess: 'geese', marks: m('.yy..') }];
    expect(checkHardMode(p, 'eight')).toEqual({ kind: 'include', letter: 'e', count: 2 });
    expect(checkHardMode(p, 'elder')).toBeNull();
  });
});

describe('helpers', () => {
  it('normalises typed input', () => {
    expect(normalizeWord(' Cr-ane1 ', 'en')).toBe('crane');
  });
  it('reports status', () => {
    expect(statusAfter([m('ggggg')], 6)).toBe('won');
    expect(statusAfter([m('g....')], 6)).toBe('playing');
    expect(statusAfter(Array(6).fill(m('g....')), 6)).toBe('lost');
  });
  it('orders languages by keyboard, then device, then the rest', () => {
    expect(orderLanguages(['en', 'fr', 'de', 'es'], ['de-DE', 'en-GB'], ['fr'])).toEqual([
      'fr',
      'de',
      'en',
      'es',
    ]);
  });
});

describe('accents', () => {
  it('folds accents that are not their own letter', () => {
    expect(normalizeWord('Árbol', 'es')).toBe('arbol');
    expect(normalizeWord('niño', 'es')).toBe('niño');
    expect(normalizeWord('ÉLÈVE', 'fr')).toBe('eleve');
    expect(normalizeWord('garçon', 'fr')).toBe('garcon');
    expect(normalizeWord('Größe', 'de')).toBe('größe');
    expect(normalizeWord('café', 'en')).toBe('cafe');
    expect(normalizeWord('a1 b-c', 'en')).toBe('abc');
  });
  it('scores folded guesses against accented answers', () => {
    const answer = normalizeWord('línea', 'es');
    expect(evaluate(normalizeWord('LINEA', 'es'), answer)).toEqual(Array(5).fill('correct'));
    expect(evaluate('niños'.slice(0, 5), 'nonos')[1]).toBe('absent');
  });
});

describe('Welsh digraphs', () => {
  it('makes ll, dd, ch... one tile each, reading left to right', async () => {
    const { normalizeWord, expandWord, displayLetter, evaluate } = await import('./game');
    const w = normalizeWord('Cyllell', 'cy');
    expect([...w].map(displayLetter)).toEqual(['c', 'y', 'll', 'e', 'll']);
    expect(expandWord(w)).toBe('cyllell');
    expect([...normalizeWord('ffordd', 'cy')].map(displayLetter)).toEqual(['ff', 'o', 'r', 'dd']);
    // Other languages are untouched.
    expect(normalizeWord('llama', 'es')).toBe('llama');
    expect(evaluate(normalizeWord('llaeth', 'cy'), normalizeWord('llaeth', 'cy')).every((m) => m === 'correct')).toBe(true);
  });
});
