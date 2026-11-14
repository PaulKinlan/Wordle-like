import { beforeEach, describe, expect, it } from 'vitest';
import { accessEnabled, clearAccessKeys, teamOrigin, verifyAccess } from './access';

const TEAM = 'letterle';
const ORIGIN = 'https://letterle.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const env = { ACCESS_TEAM: TEAM, ACCESS_AUD: AUD };

const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64 = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function keyPair() {
  return (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
}

async function token(priv: CryptoKey, claims: Record<string, unknown>, kid = 'k1') {
  const head = enc({ alg: 'RS256', kid, typ: 'JWT' });
  const body = enc(claims);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64(sig)}`;
}

const req = (t?: string) =>
  new Request('https://letterle.app/api/v1/telemetry/summary', {
    headers: t ? { 'Cf-Access-Jwt-Assertion': t } : {},
  });
const now = () => Math.floor(Date.now() / 1000);

describe('Cloudflare Access check', () => {
  let pair: CryptoKeyPair;
  let certs: Response;
  let fetched: string[];
  const doFetch = async (u: string) => {
    fetched.push(u);
    return certs.clone();
  };

  beforeEach(async () => {
    clearAccessKeys();
    fetched = [];
    pair ??= await keyPair();
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    certs = Response.json({ keys: [{ ...jwk, kid: 'k1', alg: 'RS256' }] });
  });

  it('is off unless both settings are filled in', () => {
    expect(accessEnabled({})).toBe(false);
    expect(accessEnabled({ ACCESS_TEAM: 'x', ACCESS_AUD: '' })).toBe(false);
    expect(accessEnabled(env)).toBe(true);
  });

  it('accepts a team name or the full address', () => {
    expect(teamOrigin('letterle')).toBe(ORIGIN);
    expect(teamOrigin('letterle.cloudflareaccess.com')).toBe(ORIGIN);
    expect(teamOrigin(`${ORIGIN}/`)).toBe(ORIGIN);
  });

  it('accepts a good token', async () => {
    const t = await token(pair.privateKey, {
      aud: [AUD],
      iss: ORIGIN,
      exp: now() + 600,
      nbf: now() - 5,
      email: 'a@b.c',
    });
    expect(await verifyAccess(req(t), env, doFetch)).toBe(true);
    expect(fetched).toEqual([`${ORIGIN}/cdn-cgi/access/certs`]);
  });

  it('turns away missing, expired, wrong-audience, wrong-issuer and forged tokens', async () => {
    const good = { aud: [AUD], iss: ORIGIN, exp: now() + 600 };
    expect(await verifyAccess(req(), env, doFetch)).toBe(false);
    expect(await verifyAccess(req('not.a.jwt'), env, doFetch)).toBe(false);
    expect(await verifyAccess(req(await token(pair.privateKey, { ...good, exp: now() - 120 })), env, doFetch)).toBe(false);
    expect(await verifyAccess(req(await token(pair.privateKey, { ...good, aud: ['other'] })), env, doFetch)).toBe(false);
    expect(
      await verifyAccess(
        req(
          await token(pair.privateKey, {
            ...good,
            iss: 'https://evil.cloudflareaccess.com',
          }),
        ),
        env,
        doFetch,
      ),
    ).toBe(false);
    const other = await keyPair();
    expect(await verifyAccess(req(await token(other.privateKey, good)), env, doFetch)).toBe(false);
    expect(await verifyAccess(req(await token(pair.privateKey, good, 'unknown')), env, doFetch)).toBe(false);
  });

  it('is never satisfied when Access is not set up', async () => {
    const t = await token(pair.privateKey, {
      aud: [AUD],
      iss: ORIGIN,
      exp: now() + 600,
    });
    expect(await verifyAccess(req(t), {}, doFetch)).toBe(false);
  });
});
