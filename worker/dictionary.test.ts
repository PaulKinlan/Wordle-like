import { describe, expect, it } from 'vitest';
import { acceptsDcz, deltaResponse, dictionaryHash, versioned } from './dictionary';

const HASH_B64 = 'pZGm1Av0IEBKARczz7exkNYsZb8LzaMrV7J32a2fFG4=';
const HASH_HEX = 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e';

describe('compression dictionaries', () => {
  it('only the main script and stylesheet have deltas', () => {
    expect(versioned('/assets/index-Ce1cKmd2.js')).toEqual({ name: 'index-Ce1cKmd2.js', kind: 'js' });
    expect(versioned('/assets/index-OKTF_15-.css')).toEqual({ name: 'index-OKTF_15-.css', kind: 'css' });
    expect(versioned('/assets/es-c85RQj00.js')).toBeNull();
    expect(versioned('/assets/delta/index-a.js')).toBeNull();
    expect(versioned('/assets/../index-a.js')).toBeNull();
  });

  it('reads the hash a browser sends, and nothing else', () => {
    expect(dictionaryHash(`:${HASH_B64}:`)).toBe(HASH_HEX);
    expect(dictionaryHash(null)).toBeNull();
    expect(dictionaryHash(HASH_B64)).toBeNull();
    expect(dictionaryHash(':../../index.html:')).toBeNull();
    expect(dictionaryHash(':AAAA:')).toBeNull();
  });

  it('sends dcz unless the browser only reads dcb', () => {
    expect(acceptsDcz('gzip, deflate, br, zstd, dcb, dcz')).toBe(true);
    expect(acceptsDcz('gzip, br')).toBe(true); // simplified on the way to the Worker
    expect(acceptsDcz(null)).toBe(true);
    expect(acceptsDcz('gzip, br, dcb')).toBe(false);
  });

  const assets = (found: boolean) =>
    ({
      fetch: async (url: URL) =>
        found && url.pathname === `/assets/delta/index-new.js.${HASH_HEX}.dcz`
          ? new Response('delta', { headers: { 'Cache-Control': 'public, max-age=31536000, immutable', ETag: '"x"' } })
          : new Response('<html>', { headers: { 'Content-Type': 'text/html' } }),
    }) as unknown as Fetcher;
  const request = (headers: Record<string, string>) => new Request('https://letterle.app/assets/index-new.js', { headers });
  const file = { name: 'index-new.js', kind: 'js' };

  it('answers with the delta against the build the browser has', async () => {
    const res = await deltaResponse(request({ 'Available-Dictionary': `:${HASH_B64}:` }), assets(true), file);
    expect(res?.headers.get('Content-Encoding')).toBe('dcz');
    expect(res?.headers.get('Content-Type')).toContain('text/javascript');
    expect(res?.headers.get('Vary')).toBe('Accept-Encoding, Available-Dictionary');
    expect(res?.headers.get('Use-As-Dictionary')).toBe('match="/assets/index-*.js"');
    expect(res?.headers.get('Cache-Control')).toContain('immutable');
    expect(res?.headers.get('ETag')).toBeNull();
  });

  it('falls back to the ordinary file otherwise', async () => {
    expect(await deltaResponse(request({}), assets(true), file)).toBeNull();
    expect(await deltaResponse(request({ 'Available-Dictionary': `:${HASH_B64}:` }), assets(false), file)).toBeNull();
    expect(await deltaResponse(request({ 'Available-Dictionary': `:${HASH_B64}:`, 'Accept-Encoding': 'br, dcb' }), assets(true), file)).toBeNull();
  });
});
