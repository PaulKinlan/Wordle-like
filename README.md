# Letterly

A daily five-letter word game for friends. No ads, no tracking, no on-screen
keyboard: you type with your phone's own keyboard, one letter per tile.

- **Daily**: one word a day, the same for everyone, based on your local date.
- **Unlimited**: a fresh word whenever you want.
- **Hard mode**: a rarely used word, and every revealed hint must be used in later
  guesses. It has its own daily word, saved game and stats.
- **Seven languages**: English, Spanish, French, German, Italian, Portuguese and Dutch,
  each with its own daily word. The picker lists your device's languages first.
- **Race**: play friends on the same word in real time (up to 4 players). Share an
  invite link; when someone finishes a row, everyone else has 5 seconds to finish
  theirs. First to find the word wins, otherwise the best single row on points.
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

All routes are under `/api/v1` and keyed by language code (`en`, `es`, `fr`, `de`, `it`, `pt`, `nl`).

| Route | What it does |
| --- | --- |
| `GET /languages` | Supported languages |
| `GET /:lang/daily?date=YYYY-MM-DD&hard=1` | Puzzle id and number for a local date |
| `POST /:lang/random?hard=1` | A new unlimited puzzle id |
| `GET /:lang/words` | Every accepted guess (cached by the service worker for instant checks) |
| `POST /:lang/play` | `{ puzzle, guesses }` → `{ rows, status, hard, answer? }` |

| `POST /rooms` | `{ lang, hard }` → `{ code }`: a new race room |
| `GET /rooms/:code/socket` | WebSocket for one player in a race (see below) |

Puzzle ids are `d:<date>` (daily) or `r:<16 hex>` (unlimited), with `dh:`/`rh:`
for hard mode, which draws from the rare-word pool (`en:rare`, its own private order). Daily puzzle #1
is 14 November 2026.

### Multiplayer races

Each race room is a [Durable Object](https://developers.cloudflare.com/durable-objects/)
(`worker/room.ts`), named by its 6-character code, with SQLite storage. The
binding and migration are in `wrangler.jsonc`, so Cloudflare creates it on
deploy; there's nothing to set up. Players connect over a WebSocket using the
hibernation API, so a quiet room costs nothing, and keep-alive pings are
answered without waking it. Rooms delete themselves after a day without activity.

The rules live in `worker/race.ts` (pure code, unit tested) and
`shared/race.ts` (scoring and message types):

- The host starts a round once at least one friend is connected. The room picks
  a random word from the same private order as unlimited play.
- Every guess is checked and scored on the server. Other players only ever see
  your colours, never your letters, and nobody sees the answer until the end.
- When a player finishes row *k*, everyone who hasn't finished row *k* has
  5 seconds to do it, counted from when they finished their previous row if
  that was later. A row that runs out is lost (shown hatched). The room uses a
  Durable Object alarm for the clock, so it's enforced even if a phone is asleep.
- The first player to find the word wins. If nobody does, each player's best
  single row scores 2 points per green and 1 per yellow; a tie goes to whoever
  reached that score first.
- Players rejoin with a token kept on their device, so a reload or a dropped
  connection puts them back where they were. Someone who joins mid-round plays
  from the next round, and the host can start another round with a new word.

Messages are JSON: the client sends `join`, `start`, `guess` and `ping`; the
room replies with `welcome`, `state` (each player's own view) and `error`.

### Word lists

Each language has three lists in `worker/words/<lang>/`:
`candidates.json` (common words that can be an answer), `rare.json` (rarely
used words, the hard mode answers) and `allowed.json` (other accepted guesses).
Rebuild them with `npm run words` (or `npm run words -- es fr` for some).

- **English** comes from SCOWL via `wordlist-english`: candidates from the common
  levels, rare words from levels 40-50.
- **Spanish, French, German, Italian, Portuguese, Dutch** combine word
  frequencies counted from film subtitles
  ([FrequencyWords](https://github.com/hermitdave/FrequencyWords), CC BY-SA 4.0,
  downloaded by the script and not committed) with the Hunspell dictionaries
  from [wooorm/dictionaries](https://github.com/wooorm/dictionaries) (the
  `dictionary-xx` dev dependencies). Answers are dictionary headwords, so
  mostly base forms rather than every conjugation; the most common ones are
  candidates and the next ones are the rare pool. Any word the dictionary
  accepts is a valid guess. Each folder has a `LICENSE` with its sources.

To add a language: add it to `shared/languages.ts` (with its alphabet), add it
to `INTL` in `scripts/build-wordlists.mjs`, run `npm run words -- <code>`, and
import the three lists in `worker/words.ts`. The tests check every list.

### Accents

Each language lists the letters that count as their own letter (its
`alphabet` in `shared/languages.ts`). Any other accented letter is folded to
its base letter, so typing `é` or `e` is the same in French, while `ñ` stays
separate in Spanish and `ä ö ü ß` in German. The folding is in `normalizeWord`
(`shared/game.ts`), used for typing, the word lists and scoring. Answers are
stored with their accents, so the real spelling (`LÍNEA`) is shown when a game
ends, and German `ß` is shown as `ẞ` in a tile.

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

- **Push notifications**: store subscriptions in the same D1 database, VAPID keys as Worker
  secrets, a cron trigger in `wrangler.jsonc`, and a `push` handler in `public/sw.js`.
