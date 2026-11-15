import { describe, expect, it } from 'vitest';
import { CHANGELOG, LATEST } from './changelog';

describe("What's new", () => {
  it('lists days newest first, as real dates', () => {
    const dates = CHANGELOG.map((d) => d.date);
    for (const date of dates) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(date);
    }
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
    expect(LATEST).toBe(dates[0]);
  });

  it('has a title, player text and pull requests for every entry', () => {
    for (const day of CHANGELOG) {
      expect(day.entries.length, day.date).toBeGreaterThan(0);
      for (const e of day.entries) {
        expect(e.title.trim(), day.date).not.toBe('');
        expect(e.text.trim(), e.title).not.toBe('');
        expect(e.prs.length, e.title).toBeGreaterThan(0);
        for (const n of e.prs) expect(Number.isInteger(n) && n > 0, e.title).toBe(true);
      }
    }
  });
});
