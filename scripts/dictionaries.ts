// Smaller updates: Compression Dictionary Transport.
// https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression_dictionary_transport
//
// A browser that already has an older build's script or stylesheet tells the
// server which one (Available-Dictionary), and the server can answer with only
// what changed, compressed against that old file ("dcz": Zstandard with the old
// file as its dictionary). For this app that turns a 23 KB script download
// into about 2 KB after a typical release.
//
// The deltas are made here, at build time, so the Worker only has to pick a
// file (worker/dictionary.ts). The older builds come from the live site:
//
//   /dictionaries.json                  the last few builds' file names, newest first
//   /assets/index-<hash>.js|css         the older files themselves, carried forward
//                                       so the next build can still read them
//   /assets/delta/<file>.<sha256>.dcz   this build's file, as a delta against the
//                                       older file with that SHA-256
//
// If the live site can't be reached, the build simply has no deltas and every
// browser gets the ordinary Brotli file. Nothing else depends on this.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, zstdCompressSync } from 'node:zlib';
import type { Plugin } from 'vite';
import { SITE } from './seo';

/** How many builds back a returning player can be and still get a delta. */
const KEEP = 6;
/** Only the main script and stylesheet: the names Vite gives the entry files. */
const NAME = /^index-[\w-]+\.(js|css)$/;
/** Start of a dcz body: a Zstandard skippable frame holding the dictionary's hash (RFC 9842). */
const DCZ_MAGIC = Buffer.from([0x5e, 0x2a, 0x4d, 0x18, 0x20, 0x00, 0x00, 0x00]);

export interface Build {
  js?: string;
  css?: string;
}

/** `file` as a dcz body: what changed since `dictionary`. */
export function dcz(file: Buffer, dictionary: Buffer): Buffer {
  const delta = zstdCompressSync(file, { params: { [constants.ZSTD_c_compressionLevel]: 19 }, dictionary });
  return Buffer.concat([DCZ_MAGIC, createHash('sha256').update(dictionary).digest(), delta]);
}

async function get(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    // A missing file used to come back as the home page.
    return res.ok && !res.headers.get('Content-Type')?.startsWith('text/html') ? res : null;
  } catch {
    return null;
  }
}

/** Vite plugin: after the client build, writes the deltas against the live site's recent builds. */
export function dictionaries(): Plugin {
  return {
    name: 'letterle-dictionaries',
    writeBundle: {
      sequential: true,
      async handler(options, bundle) {
        const dir = options.dir;
        if (!dir || !existsSync(join(dir, 'index.html'))) return; // not the client build (e.g. the Worker)
        const names = Object.keys(bundle)
          .map((f) => f.replace(/^assets\//, ''))
          .filter((f) => NAME.test(f));
        const current: Build = { js: names.find((n) => n.endsWith('.js')), css: names.find((n) => n.endsWith('.css')) };

        // DICTIONARY_SOURCE: another site to read older builds from (for testing), or "off".
        const source = process.env.DICTIONARY_SOURCE ?? SITE;
        let older: Build[] = [];
        if (source !== 'off') {
          const res = await get(`${source}/dictionaries.json`);
          const list: unknown = await res?.json().catch(() => null);
          if (Array.isArray(list)) older = list.filter((b): b is Build => !!b && typeof b === 'object').slice(0, KEEP - 1);
        }

        mkdirSync(join(dir, 'assets', 'delta'), { recursive: true });
        const kept: Build[] = [];
        let made = 0;
        for (const build of older) {
          const keep: Build = {};
          for (const kind of ['js', 'css'] as const) {
            const name = build[kind];
            const now = current[kind];
            if (typeof name !== 'string' || !NAME.test(name) || !name.endsWith(`.${kind}`) || !now) continue;
            keep[kind] = name;
            if (name === now) continue; // unchanged since that build: the browser already has it
            const path = join(dir, 'assets', name);
            if (!existsSync(path)) {
              const res = await get(`${source}/assets/${name}`);
              if (!res) {
                delete keep[kind];
                continue;
              }
              writeFileSync(path, Buffer.from(await res.arrayBuffer()));
            }
            const file = readFileSync(join(dir, 'assets', now));
            const dictionary = readFileSync(path);
            const delta = dcz(file, dictionary);
            // Never worth sending if plain Brotli is as small.
            if (delta.length >= brotliCompressSync(file).length) continue;
            const hash = createHash('sha256').update(dictionary).digest('hex');
            writeFileSync(join(dir, 'assets', 'delta', `${now}.${hash}.dcz`), delta);
            made++;
          }
          if (keep.js || keep.css) kept.push(keep);
        }
        // This build first; a build identical to the one before it isn't listed twice.
        const builds = [current, ...kept].filter((b, i, all) => i === 0 || b.js !== all[i - 1].js || b.css !== all[i - 1].css);
        writeFileSync(join(dir, 'dictionaries.json'), JSON.stringify(builds.slice(0, KEEP)));
        console.log(`dictionaries: ${made} delta file(s) against ${kept.length} earlier build(s) from ${source}`);
      },
    },
  };
}
