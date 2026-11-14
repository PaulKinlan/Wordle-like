import { describe, expect, it } from 'vitest';
import { OG_HEIGHT, OG_WIDTH, parseResult, raceImage, resultImage } from './og';

describe('parseResult', () => {
  it('reads a won daily game', () => {
    const r = parseResult('en', 'd123', '01200-02120-22222');
    expect(r).toMatchObject({ daily: 123, hard: false, won: true });
    expect(r?.rows).toHaveLength(3);
  });
  it('reads a lost hard unlimited game', () => {
    const r = parseResult('fr', 'uh', Array(6).fill('01200').join('-'));
    expect(r).toMatchObject({ daily: null, hard: true, won: false });
  });
  it('rejects bad input', () => {
    expect(parseResult('xx', 'd1', '22222')).toBeNull(); // unknown language
    expect(parseResult('en', 'd1', '2222')).toBeNull(); // wrong length
    expect(parseResult('en', 'd1', '22222-22222')).toBeNull(); // solved twice
    expect(parseResult('en', 'd1', '01200')).toBeNull(); // lost before the last row
    expect(parseResult('en', 'z1', '22222')).toBeNull();
    expect(parseResult('en', 'd1', '01300')).toBeNull();
    expect(parseResult('en', 'd1', Array(7).fill('01200').join('-'))).toBeNull();
  });
});

describe('images', () => {
  const size = (png: Uint8Array) => {
    const v = new DataView(png.buffer, png.byteOffset);
    return [v.getUint32(16), v.getUint32(20)];
  };
  it('draws a 1200x630 PNG for a result and a race', async () => {
    const result = await resultImage(parseResult('en', 'd123', '01200-02120-22222')!, 'letterle.app');
    expect([...result.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(size(result)).toEqual([OG_WIDTH, OG_HEIGHT]);
    const race = await raceImage('ABC234', 'en', 'letterle.app');
    expect(size(race)).toEqual([OG_WIDTH, OG_HEIGHT]);
  });
});
