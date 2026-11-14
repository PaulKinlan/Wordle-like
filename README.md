# Letterly

A daily five-letter word game for friends. No ads, no tracking, no on-screen
keyboard: you type with your phone's own keyboard, one letter per tile.

- **Daily**: one word a day, the same for everyone, based on your local date.
- **Unlimited**: a fresh word whenever you want.
- **Hard mode**: a rarely used word, and every revealed hint must be used in later
  guesses. It has its own daily word, saved game and stats.
- **Share**: a spoiler-free emoji grid through the share sheet, or copied to the clipboard.
- **Stats**: played, win rate, streaks and guess distribution, kept on your device.
- **Installable PWA** that opens offline, with a strict Content Security Policy.

The name "Letterly" is a placeholder; change it in `index.html`,
`public/manifest.webmanifest` and `public/icons/icon.svg`.

## How it fits together

```
index.html, src/        the PWA (TypeScript + Vite, no framework)
shared/                 game rules used by both sides (scoring, hard mode, languages)
worker/                 Cloudflare Worker: the /api/* routes and the word lists
public/                 static files: _headers (CSP), manifest, service worker, icons
```

The Worker is the source of truth. The client never sees the answer until the
game ends: each guess is sent with the earlier guesses to `/api/v1/<lang>/play`,
which checks the word list and hard mode and returns the colours. The server
keeps no game state.

### Keeping the answers private

The repo is public, so it never contains the answers in order. It only has the
*candidate* words. The first time a language is played, the Worker shuffles
those candidates at random and stores the order in a D1 database. Daily puzzle
*N* is row *N − 1* in that order, and an unlimited puzzle's random token picks a
row. Nobody can work out a day's word from the code, and there's no secret to set.

The D1 database is created automatically on the first deploy (the binding in
`wrangler.jsonc` has no `database_id`), and the Worker creates its tables and
fills them on the first request. Local dev gets its own local database and its
own shuffle.

A future **offline mode** would be a separate mode that ships its own word list
to the client and picks words on the device. It would never use the daily order,
so Daily stays server-only.

### API

All routes are under `/api/v1` and keyed by language code (only `en` today).

| Route | What it does |
| --- | --- |
| `GET /languages` | Supported languages |
| `GET /:lang/daily?date=YYYY-MM-DD&hard=1` | Puzzle id and number for a local date |
| `POST /:lang/random?hard=1` | A new unlimited puzzle id |
| `GET /:lang/words` | Every accepted guess (cached by the service worker for instant checks) |
| `POST /:lang/play` | `{ puzzle, guesses }` → `{ rows, status, hard, answer? }` |

Puzzle ids are `d:<date>` (daily) or `r:<16 hex>` (unlimited), with `dh:`/`rh:`
for hard mode, which draws from the rare-word pool (`en:rare`, its own private order). Daily puzzle #1
is 14 November 2026.

### Word lists

`worker/words/<lang>/candidates.json` (common words that can be an answer),
`rare.json` (rarely used words, the hard mode answers, from SCOWL's less frequent
levels 40-50) and `allowed.json` (other accepted guesses). English comes from SCOWL via `wordlist-english`;
rebuild with `npm run words`. To add a language later: add it to
`shared/languages.ts`, add its two lists, and import them in `worker/words.ts`.

### Typing with the phone keyboard

An invisible text field sits over the board, with autocorrect, autocomplete,
autocapitalise, spellcheck and writing suggestions turned off. Input is cleaned
to letters and shown one per tile. Where the
[VirtualKeyboard API](https://developer.mozilla.org/docs/Web/API/VirtualKeyboard_API)
exists (Chrome on Android), the keyboard overlays the page, we lay out above it
with `env(keyboard-inset-height)`, and tapping the board calls
`navigator.virtualKeyboard.show()`. Elsewhere we measure the keyboard with
`visualViewport`. The tiles resize to fit whatever space is left.

A strip of letters under the board shows which letters you've tried. It isn't
tappable; it just replaces the colour hints a keyboard would show.

The [Keyboard API](https://developer.mozilla.org/docs/Web/API/Keyboard_API)
(`getLayoutMap`) is used, where available, to put languages that match your
physical keyboard layout first in the language picker, then your device
languages (`navigator.languages`), then the rest. English is the default.

### Security

`public/_headers` sets the CSP for every page: `default-src 'none'`, scripts,
styles, images and fetches from our own origin only, no frames, Trusted Types
required. There are no third-party requests at all. The API sets its own
`default-src 'none'` CSP.

## Develop

```sh
npm install
npm run dev        # Vite + the Worker running in workerd, with hot reload
npm test           # unit tests for the rules and the API
npm run typecheck
npm run preview    # production build served by wrangler
```

## Deploy

Every push to GitHub deploys through **Cloudflare Workers Builds**, which is
connected to this repo in the Cloudflare dashboard. Pushes to `main` go to
production at `https://wordle-like.<your-subdomain>.workers.dev`, and pull
requests get a preview build. No API tokens or GitHub secrets are needed.

The default deploy command (`npx wrangler deploy`) works as is:
`wrangler.jsonc` has a `build.command` that runs the Vite build first, so the
build command in the dashboard can stay empty. GitHub Actions only runs checks
(typecheck, tests, build).

To use a custom domain later, add it under the Worker's *Settings → Domains & Routes*.

## Ready for later steps

- **More languages**: the API, storage keys, stats and picker are already per language.
- **Multiplayer**: add a Durable Object for rooms under `/api/v1/rooms/*`;
  `shared/game.ts` already scores guesses on the server.
- **Push notifications**: store subscriptions in the same D1 database, VAPID keys as Worker
  secrets, a cron trigger in `wrangler.jsonc`, and a `push` handler in `public/sw.js`.
