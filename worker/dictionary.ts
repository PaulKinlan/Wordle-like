// Smaller updates with Compression Dictionary Transport: a browser that still
// has an older build's script or stylesheet gets only what changed. The delta
// files are made at build time (scripts/dictionaries.ts has the whole story);
// this picks the right one, or falls back to the ordinary file.
//
// On letterle.app this needs Cloudflare's "Shared Dictionaries" zone setting
// (Speed > Settings > Content Optimization). While it is off Cloudflare
// removes the headers involved, and everyone gets the ordinary file.

/** The main script and stylesheet: the only files with deltas. */
const VERSIONED = /^\/assets\/(index-[\w-]+\.(js|css))$/;

/** The file name, if this path is one that can be a dictionary and have deltas. */
export function versioned(pathname: string): { name: string; kind: string } | null {
  const m = VERSIONED.exec(pathname);
  return m ? { name: m[1], kind: m[2] } : null;
}

/** Tells the browser to keep this response as the dictionary for the next build's file of the same kind. */
export const useAsDictionary = (kind: string) => `match="/assets/index-*.${kind}"`;

/**
 * The SHA-256 a browser sent in Available-Dictionary (":<base64>:"), as hex.
 * Null for anything else, so the value can go safely into a file path.
 */
export function dictionaryHash(header: string | null): string | null {
  const m = header && /^:([A-Za-z0-9+/]{43}=):$/.exec(header.trim());
  if (!m) return null;
  let bytes: string;
  try {
    bytes = atob(m[1]);
  } catch {
    return null;
  }
  if (bytes.length !== 32) return null;
  return [...bytes].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

/** Whether the browser can read a dcz response. Cloudflare may simplify Accept-Encoding before the Worker sees it. */
export function acceptsDcz(acceptEncoding: string | null): boolean {
  const list = (acceptEncoding ?? '').toLowerCase().split(',').map((s) => s.trim().split(';')[0]);
  // Every browser that sends Available-Dictionary so far reads both dcb and dcz;
  // only one that names dcb without dcz is known not to.
  return list.includes('dcz') || !list.includes('dcb');
}

/**
 * This build's file as a delta against the one the browser has, if there is
 * one. `assets` is the static files binding.
 */
export async function deltaResponse(request: Request, assets: Fetcher, file: { name: string; kind: string }): Promise<Response | null> {
  const hash = dictionaryHash(request.headers.get('Available-Dictionary'));
  if (!hash || !acceptsDcz(request.headers.get('Accept-Encoding'))) return null;
  const delta = await assets.fetch(new URL(`/assets/delta/${file.name}.${hash}.dcz`, request.url));
  // No delta against that build: static assets answer with the home page instead.
  if (!delta.ok || delta.headers.get('Content-Type')?.startsWith('text/html')) return null;
  // Keeps the security and caching headers public/_headers gives every built file.
  const headers = new Headers(delta.headers);
  headers.set('Content-Type', file.kind === 'js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
  headers.set('Content-Encoding', 'dcz');
  headers.set('Vary', 'Accept-Encoding, Available-Dictionary');
  headers.set('Use-As-Dictionary', useAsDictionary(file.kind));
  headers.delete('Content-Length');
  headers.delete('ETag');
  // The body is already encoded: don't let the runtime compress it again.
  return new Response(delta.body, { status: 200, headers, encodeBody: 'manual' });
}
