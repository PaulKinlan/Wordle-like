# Letterle

A daily five-letter word game for friends. No ads, no tracking, no on-screen
keyboard: you type with your phone's own keyboard, one letter per tile.

- **Daily**: one word a day, the same for everyone, based on your local date.
- **Unlimited**: a fresh word whenever you want.
- **Hard mode**: a rarely used word, and every revealed hint must be used in later
  guesses. It has its own daily word, saved game and stats.
- **Nineteen word languages**: English, Spanish, French, German, Italian, Portuguese,
  Dutch, Catalan, Basque, Welsh, Irish, Scottish Gaelic, Breton, Polish, Swedish,
  Turkish, Greek, Japanese and Korean, each with its own daily word. The picker lists your device's languages first.
- **Race**: play friends on the same word in real time (up to 4 players). Share an
  invite link; when someone finishes a row, everyone else has 5 seconds to finish
  theirs. First to find the word wins, otherwise the best single row on points.
- **Interface language**: menus and messages in English, Spanish, French, German,
  Italian, Portuguese or Dutch, chosen separately from the word language. English is
  the default; your device's languages are listed first.
- **Share**: a picture of your grid (made on the device) plus a spoiler-free emoji grid,
  through the share sheet, or the text copied to the clipboard. Daily shares include your streak.
- **Daily reminder**: an optional notification at the time you choose, skipped on days
  you've already played.
- **Stats**: played, win rate, streaks and guess distribution, kept on your device.
- **Installable PWA** that opens offline, with a strict Content Security Policy.

The game is Letterle, at https://letterle.app. The name appears in `index.html`,
`public/manifest.webmanifest`, the locale files and the share card.

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

| `GET /push/key` | VAPID public key (made on first use) |
| `POST /push/subscribe` | `{ subscription, tz, hour, lang }`: turn on the daily reminder |
| `POST /push/played` | `{ endpoint, date }`: played today, skip today's reminder |
| `POST /push/unsubscribe` | `{ endpoint }` |
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

### Daily notifications

Players can turn on a daily reminder in Settings and pick the hour. The browser
subscribes with Web Push, and the Worker stores the subscription, time zone
and hour in D1 (`push_subs`). A cron trigger runs every hour
(`wrangler.jsonc`), and each subscriber gets one notification a day at or
after their hour, unless they've already finished that day's word.
Subscriptions the push service reports as gone (404/410) are deleted.
Encryption (RFC 8291) and VAPID signing (RFC 8292) are done with WebCrypto in
`worker/webpush.ts`, with no dependencies. The Worker only sends to the
browser push services (Google, Mozilla, Apple, Microsoft).

On iPhone and iPad, web push only works once Letterle is added to the Home
Screen; the setting says so.

**Setup: none.** On the first request to `/api/v1/push/key`, the Worker makes
its own VAPID key pair with WebCrypto and stores it in D1 (`push_config`). The
private key never leaves the Worker; only the public key is served. The VAPID
subject (the contact push services see) is https://letterle.app. Keep the D1
database: if the keys are lost, everyone has to turn reminders off and on
again.

**Optional override.** To use your own keys or contact instead, run
`npm run vapid` and add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and/or
`VAPID_SUBJECT` (like `mailto:you@example.com`) as **Secret** variables in
**Workers & Pages → wordle-like → Settings → Variables and Secrets**. Secrets
win over the stored keys, and changing keys means everyone has to turn
reminders off and on again. For local development, put them in `.dev.vars`
(git-ignored).

The free Workers plan allows 50 outgoing requests per run, so each hourly run
sends at most 40 reminders, and anyone left over is picked up the next hour.

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

### Interface language

The interface language is a separate setting from the word language, so you
can play Spanish words with English menus. It stays English until the player
picks another. The picker lists languages that match the keyboard layout and
`navigator.languages` first, then the rest (the same ordering as the word
language picker, which also defaults to English).

Messages live in `src/locales/<code>.ts`. `en.ts` is the source; the type
check fails if another locale misses a key, and a unit test checks that
placeholders like `{n}` match. Static text in `index.html` is marked with
`data-i18n` (text), `data-i18n-rich` (with `**bold**`, rendered as
`<strong>` without using HTML, so Trusted Types stay happy) and
`data-i18n-aria` (aria-label). Other locales load on demand as small chunks.
The non-English translations were machine-assisted; corrections from native
speakers are welcome. To add one, copy `es.ts`, translate it and add it to
`UI_LANGUAGES` and `loaders` in `src/i18n.ts`. Daily reminder texts are in
`worker/push.ts`.

### Accents

Each language lists the letters that count as their own letter (its
`alphabet` in `shared/languages.ts`). Any other accented letter is folded to
its base letter, so typing `é` or `e` is the same in French, while `ñ` stays
separate in Spanish and `ä ö ü ß` in German. The folding is in `normalizeWord`
(`shared/game.ts`), used for typing, the word lists and scoring. Answers are
stored with their accents, so the real spelling (`LÍNEA`) is shown when a game
ends, and German `ß` is shown as `ẞ` in a tile.

### Welsh, Japanese and Korean

- **Welsh**: the digraphs ch, dd, ff, ng, ll, ph, rh and th take one tile each.
  Inside the game each is a single private-use character (`digraphs` in
  `shared/languages.ts`), so scoring and hard mode just count letters.
- **Japanese**: 4 kana and 8 guesses. Katakana folds to hiragana; voiced (が) and
  small (っ) kana are letters of their own. Lists: `scripts/build-japanese.mjs`.
- **Korean**: 6 letters, one per key on a standard keyboard: 한국 is ㅎ ㅏ ㄴ ㄱ ㅜ ㄱ,
  and combined vowels split (과 is ㄱ ㅗ ㅏ). See `shared/hangul.ts`. Answers are
  stored in syllables, so 한국 is shown when a game ends. Lists:
  `scripts/build-korean.mjs`.

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

## Health, version and observability

- **Version:** Settings shows the build's commit (e.g. "Version da70376"), linking to it on GitHub. Vite fills it in at build time from `WORKERS_CI_COMMIT_SHA` (Workers Builds) or `git rev-parse HEAD` (`shared/version.ts`).
- **`/health`** returns `{ status, commit, commitUrl, built, checks: { database } }`, with a 503 if D1 can't be reached.
- **Real-user monitoring** (`src/telemetry.ts`, no third parties): JavaScript errors, unhandled rejections, failed resources, CSP violations, deprecation and intervention reports, and Core Web Vitals (LCP, INP, CLS, FCP, TTFB). They are sent with `sendBeacon` to `POST /api/v1/telemetry` when the page is hidden. The browser's Reporting API also posts to `/api/v1/reports` (the CSP's `report-to` and the `Reporting-Endpoints` header), which also catches crash reports. Nothing personal is stored: no IP address or user agent string, only the browser family, device class, page path and commit. The rows live in D1 (`telemetry`), and the hourly cron deletes anything older than 30 days.
- **Dashboard** at `/dashboard/` shows Web Vitals at the 75th percentile (overall, and by day, device, browser, version and page), grouped problems with details, and daily volume. It needs a key: the Worker makes one on first use and keeps it in D1 (`app_config`, `dashboard_key`). Open `/dashboard/#key=<key>` once, and the device remembers it. A `DASHBOARD_KEY` secret overrides it.
- **Analytics, instead of Google Analytics** (no cookies, no third parties): page views (referrer host, `utm_*`, landing page, how the app was launched, installed or in a tab, device language, screen, theme, connection), time on page, and product events from `track()` (shares, settings, installs, reminders, races). The Worker records games itself in `/play` (started, finished, won, guesses, mode, language) and races in the room (created, started, finished, players). Visitors are counted like privacy-first analytics tools do: a hash of IP + user agent + a salt that changes daily and is then deleted, so a visitor is counted once a day but can't be followed across days. Usage rows are kept 13 months; the dashboard's Audience section shows live visitors, totals, a per-day table, the visit to share funnel, games by mode and language, the guess distribution and every breakdown above.
- **Debug log:** open the game with `?debug` for a log panel at the bottom of the page (`src/debug.ts`).
- **Bug reports:** "How to play" links to a new GitHub issue with the version, mode and browser filled in.

## Search and link previews

`scripts/seo.ts` is a Vite plugin that runs at build time:

- **Language pages:** it writes `/es/`, `/fr/`, `/de/`, `/it/`, `/pt/` and `/nl/`. Each one is the game with its own title, description, canonical URL and `og:locale`. Opening one sets the word and interface language until the player picks their own.
- **Shared head on every page:**
  - `hreflang` links between all the languages, plus `x-default`;
  - JSON-LD structured data: a `WebSite`, and a `VideoGame` / `WebApplication` that is free, single and multiplayer.
- **Crawler files:** `robots.txt` (keeps crawlers out of `/api/` and `/dashboard/`) and `sitemap.xml` with the language alternates.

To add a language page, add it to `PAGES` in `scripts/seo.ts`.

**Link previews for shared results and race invites** (`worker/og.ts`):

- Share links look like `/s/en/d123/01200-22222`: the language, the mode (`d` plus the number, or `u`, with `h` for hard), and the colours only, one digit per tile. Invites look like `/r/ABC234`.
- The Worker serves the game page for these links, with the title, description and `og:image` rewritten by `HTMLRewriter`.
- The image (`/og/...png`, 1200×630) is drawn by the Worker, with no image library. Glyphs from Inter are pre-rendered into `worker/og-font.ts` by `scripts/make-og-font.mjs`, and a small PNG encoder uses `CompressionStream`. Images are cached at the edge.
- A shared link opens the game in the language it was played in. An invite opens the race.

## Agents can play (WebMCP, an experiment)

`src/webmcp.ts` registers four tools with `document.modelContext`, where the browser supports WebMCP:

- `get_rules` explains how to play.
- `get_game_state` returns the board, the marks, the letter hints and how many guesses are left. It includes the answer only once the game is over.
- `guess_word` types a word onto the board and submits it, with the same checks as a person gets.
- `new_game` switches between the daily and unlimited games.

Agent tool use shows in the dashboard as the `agent_tool` action.

## Ready for later steps

- **Push notifications**: store subscriptions in the same D1 database, VAPID keys made by the
  Worker and kept in D1, a cron trigger in `wrangler.jsonc`, and a `push` handler in `public/sw.js`.
