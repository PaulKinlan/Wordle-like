// Web Push without dependencies: VAPID (RFC 8292) and aes128gcm payload
// encryption (RFC 8291), using only WebCrypto.

export interface PushSubscriptionKeys {
  endpoint: string;
  /** base64url P-256 public key of the browser (65 bytes uncompressed). */
  p256dh: string;
  /** base64url 16-byte auth secret. */
  auth: string;
}

export interface VapidKeys {
  /** base64url uncompressed P-256 public key (65 bytes). */
  publicKey: string;
  /** base64url P-256 private key scalar (32 bytes). */
  privateKey: string;
  /** Contact for push services, "mailto:..." or an https URL. */
  subject: string;
}

const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, key, length * 8);
  return new Uint8Array(bits as ArrayBuffer);
}

/** Encrypts a payload for one subscription (RFC 8291, aes128gcm). */
export async function encryptPayload(
  sub: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
  payload: Uint8Array,
  // For tests: fixed salt and server key pair.
  fixed?: { salt: Uint8Array; keys: CryptoKeyPair },
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromB64url(sub.p256dh);
  const authSecret = fromB64url(sub.auth);
  const keys =
    fixed?.keys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      keys.privateKey,
      256,
    ),
  );
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt: Uint8Array = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  // One record: the payload, then the 0x02 "last record" delimiter.
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aes, concat(payload, new Uint8Array([2]))),
  );
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

/** A signed VAPID JWT for the push service at `endpoint`. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Date.now()): Promise<string> {
  const pub = fromB64url(vapid.publicKey);
  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: b64url(pub.slice(1, 33)),
      y: b64url(pub.slice(33, 65)),
      d: vapid.privateKey,
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    enc.encode(
      JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned) as BufferSource);
  return `vapid t=${unsigned}.${b64url(sig)}, k=${vapid.publicKey}`;
}

/** Sends one notification. Returns the push service's HTTP status. */
export async function sendPush(
  sub: PushSubscriptionKeys,
  data: unknown,
  vapid: VapidKeys,
  opts: { ttl?: number; topic?: string } = {},
): Promise<number> {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(data)));
  const headers: Record<string, string> = {
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 12 * 3600),
    Urgency: 'normal',
    Authorization: await vapidAuthorization(sub.endpoint, vapid),
  };
  // A newer notification with the same topic replaces an undelivered one.
  if (opts.topic) headers.Topic = opts.topic;
  // Push services answer directly; never follow a redirect to somewhere else.
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body, redirect: 'manual' });
  return res.status;
}
