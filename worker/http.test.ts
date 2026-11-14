import { describe, expect, it } from 'vitest';
import { clientKey, withinLimit } from './http';

const from = (ip?: string) => new Request('https://x/', { headers: ip ? { 'CF-Connecting-IP': ip } : {} });

describe('rate limit keys', () => {
  it('counts an IPv4 address as itself', () => {
    expect(clientKey(from('203.0.113.7'))).toBe('203.0.113.7');
  });
  it('counts an IPv6 address by its /64', () => {
    expect(clientKey(from('2001:db8:1:2:aaaa:bbbb:cccc:dddd'))).toBe('2001:db8:1:2');
    expect(clientKey(from('2001:db8:1:2::1'))).toBe('2001:db8:1:2');
    expect(clientKey(from('2001:db8::1'))).toBe('2001:db8:0:0');
    expect(clientKey(from('::1'))).toBe('0:0:0:0');
  });
  it('is not limited without a limiter or an address', async () => {
    expect(await withinLimit(undefined, from('203.0.113.7'), 'api')).toBe(true);
    const never = { limit: async () => ({ success: false }) };
    expect(await withinLimit(never, from(), 'api')).toBe(true);
    expect(await withinLimit(never, from('203.0.113.7'), 'api')).toBe(false);
  });
  it('keeps each scope and visitor apart, and survives a broken limiter', async () => {
    const seen: string[] = [];
    const limiter = { limit: async ({ key }: { key: string }) => (seen.push(key), { success: true }) };
    await withinLimit(limiter, from('203.0.113.7'), 'room');
    await withinLimit(limiter, from('203.0.113.8'), 'tel');
    expect(seen).toEqual(['room:203.0.113.7', 'tel:203.0.113.8']);
    const broken = { limit: async () => Promise.reject(new Error('down')) };
    expect(await withinLimit(broken, from('203.0.113.7'), 'api')).toBe(true);
  });
});
