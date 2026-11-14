// Cloudflare Access in front of the dashboard. Access signs people in at the
// edge on letterle.app, then adds a signed token (a JWT) to each request. The
// Worker checks that token itself, because the workers.dev address isn't
// behind the same Access application. No library: WebCrypto does RS256.

export interface AccessEnv {
  /** The Zero Trust team name, or its full https://<team>.cloudflareaccess.com address. */
  ACCESS_TEAM?: string;
  /** The Access application's Audience (AUD) tag. */
  ACCESS_AUD?: string;
}

type Fetch = (url: string) => Promise<Response>;

const KEYS_TTL = 60 * 60 * 1000;
let cache: { team: string; at: number; keys: Map<string, CryptoKey> } | undefined;

export function accessEnabled(env: AccessEnv): boolean {
  return Boolean(env.ACCESS_TEAM?.trim() && env.ACCESS_AUD?.trim());
}

export function teamOrigin(team: string): string {
  const t = team.trim().replace(/\/+$/, '');
  if (/^https:\/\//.test(t)) return t;
  return `https://${t.replace(/\.cloudflareaccess\.com$/, '')}.cloudflareaccess.com`;
}

function b64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

const decodeJson = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s))) as Record<string, unknown>;

async function signingKeys(origin: string, doFetch: Fetch, refresh: boolean): Promise<Map<string, CryptoKey>> {
  if (!refresh && cache && cache.team === origin && Date.now() - cache.at < KEYS_TTL) return cache.keys;
  const res = await doFetch(`${origin}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: ${res.status}`);
  const body = (await res.json()) as {
    keys?: (JsonWebKey & { kid?: string })[];
  };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid || jwk.kty !== 'RSA') continue;
    keys.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  cache = { team: origin, at: Date.now(), keys };
  return keys;
}

/** True when the request carries a valid Access token for this application. */
export async function verifyAccess(request: Request, env: AccessEnv, doFetch: Fetch = (u) => fetch(u)): Promise<boolean> {
  if (!accessEnabled(env)) return false;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
    const origin = teamOrigin(env.ACCESS_TEAM!);
    let keys = await signingKeys(origin, doFetch, false);
    // Access rotates its keys every few weeks: look again once for a new one.
    if (!keys.has(header.kid)) keys = await signingKeys(origin, doFetch, true);
    const key = keys.get(header.kid);
    if (!key) return false;
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return false;
    const now = Date.now() / 1000;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD!.trim())) return false;
    if (payload.iss !== origin) return false;
    if (typeof payload.exp !== 'number' || payload.exp < now - 30) return false;
    if (typeof payload.nbf === 'number' && payload.nbf > now + 30) return false;
    return true;
  } catch {
    return false;
  }
}

/** Tests only. */
export function clearAccessKeys() {
  cache = undefined;
}
