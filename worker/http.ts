// Small helpers shared by the API routes: reading request bodies safely, and
// per-visitor rate limits.

/** Thrown for a body that is missing, too big, not JSON, or not a JSON object. */
export class BadBody extends Error {
  constructor(public status: 400 | 413) {
    super(status === 413 ? 'Too much data' : 'Expected a JSON object');
  }
}

/** Reads the body as text, refusing anything over `max` bytes. */
export async function readText(request: Request, max: number): Promise<string> {
  if (Number(request.headers.get('Content-Length') ?? 0) > max) throw new BadBody(413);
  const reader = request.body?.getReader();
  if (!reader) return '';
  // Read in pieces and stop early, so a huge body is never held in memory.
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new BadBody(413);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Reads a JSON object body (never null, a list or a bare value). */
export async function readObject(request: Request, max = 16 * 1024): Promise<Record<string, unknown>> {
  const text = await readText(request, max);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BadBody(400);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new BadBody(400);
  return parsed as Record<string, unknown>;
}

/**
 * Rate limiters (wrangler.jsonc "ratelimits"). All optional: tests, and any
 * deploy without the bindings, simply aren't limited.
 */
export interface LimitEnv {
  /** Ordinary play: guesses, word lists, joining a race. */
  LIMIT_API?: RateLimit;
  /** Things that write to the database or cost real CPU: reminders, telemetry, preview images. */
  LIMIT_WRITES?: RateLimit;
  /** Making race rooms. */
  LIMIT_ROOMS?: RateLimit;
}

/**
 * Who to count a request against: the IPv4 address, or the /64 of an IPv6
 * address (one home or phone gets a whole /64, so the last half is free to change).
 */
export function clientKey(request: Request): string | null {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return null;
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const groups = head ? head.split(':') : [];
  if (ip.includes('::')) {
    const rest = tail ? tail.split(':') : [];
    while (groups.length + rest.length < 8) groups.push('0');
    groups.push(...rest);
  }
  return groups.slice(0, 4).join(':');
}

/** True if this visitor is within the limit (or there is no limiter). Each `scope` is counted separately. */
export async function withinLimit(limiter: RateLimit | undefined, request: Request, scope: string): Promise<boolean> {
  if (!limiter) return true;
  const who = clientKey(request);
  if (!who) return true;
  try {
    return (await limiter.limit({ key: `${scope}:${who}` })).success;
  } catch {
    return true; // never let the limiter itself take the game down
  }
}
