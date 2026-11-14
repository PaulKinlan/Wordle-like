import { describe, expect, it } from 'vitest';
import { browserFamily, p75, rate } from './telemetry';

describe('telemetry', () => {
  it('rates Web Vitals with the standard thresholds', () => {
    expect(rate('LCP', 2500)).toBe('good');
    expect(rate('LCP', 3000)).toBe('needs-improvement');
    expect(rate('INP', 501)).toBe('poor');
    expect(rate('CLS', 0.05)).toBe('good');
    expect(rate('nope', 1)).toBeNull();
  });

  it('takes the 75th percentile', () => {
    expect(p75([])).toBeNull();
    expect(p75([5])).toBe(5);
    expect(p75([1, 2, 3, 4])).toBe(3);
    expect(p75([10, 1, 7, 3, 9, 2, 8, 4])).toBe(8);
  });

  it('keeps only a browser family, never the user agent', () => {
    expect(browserFamily('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/159.0.0.0 Mobile Safari/537.36')).toBe('Chrome');
    expect(browserFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari');
    expect(browserFamily('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/159 Safari/537.36 Edg/159')).toBe('Edge');
    expect(browserFamily(null)).toBe('Other');
  });
});
