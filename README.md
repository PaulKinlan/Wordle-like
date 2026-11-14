# Letterly

A daily five-letter word game for friends. No ads, no tracking, no on-screen
keyboard: you type with your phone's own keyboard, one letter per tile.

- **Daily**: one word a day, the same for everyone, based on your local date.
- **Unlimited**: a fresh word whenever you want.
- **Hard mode**: every revealed hint must be used in later guesses.
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
keeps no game state, so there's no database to run.

### API

All routes are under `/api/v1` and keyed by language code (only `en` today).

| Route | What it does |
| --- | --- |
| `GET /languages` | Supported languages |
| `GET /:lang/daily?date=YYYY-MM-DD` | Puzzle id and number for a local date |
| `POST /:lang/random` | A new unlimited puzzle id |
| `GET /:lang/words` | Every accepted guess (cached by the service worker for instant checks) |
| `POST /:lang/play` | `{ puzzle, guesses, hard }` → `{ rows, status, answer? }` |

Puzzle ids are `d:<date>` (daily) or `r:<16 hex>` (unlimited). The answer is
picked from the id mixed with the `PUZZLE_SECRET` secret, so it can't be worked
out from the public word list. Daily puzzle #1 is 14 November 2026.

### Word lists

`worker/words/<lang>/answers.json` (possible answers) and `allowed.json`
(other accepted guesses). English comes from SCOWL via `wordlist-english`;
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

Every push to `main` deploys to `https://wordle-like.<your-subdomain>.workers.dev`.
Pick **one** of these:

**Option A: GitHub Actions (already set up in `.github/workflows/ci.yml`).**
Add two repository secrets under *Settings → Secrets and variables → Actions*:

- `CLOUDFLARE_ACCOUNT_ID`: from the Cloudflare dashboard, *Workers & Pages* sidebar.
- `CLOUDFLARE_API_TOKEN`: create at *My Profile → API Tokens* with the
  **Edit Cloudflare Workers** template.

Until both exist, the deploy job is skipped and only the checks run.

**Option B: Cloudflare Workers Builds (no GitHub secrets).** In the dashboard,
*Workers & Pages → Create → Import a repository*, pick this repo, build command
`npm run build`, deploy command `npx wrangler deploy`. If you use this, delete
the `deploy` job from the workflow so it doesn't deploy twice.

**Then, once:** set the puzzle secret so answers can't be predicted from the
public repo (any long random string; changing it later changes every answer):

```sh
npx wrangler secret put PUZZLE_SECRET
```

To use a custom domain later, add it under the Worker's *Settings → Domains & Routes*.

## Ready for later steps

- **More languages**: the API, storage keys, stats and picker are already per language.
- **Multiplayer**: add a Durable Object for rooms under `/api/v1/rooms/*`;
  `shared/game.ts` already scores guesses on the server.
- **Push notifications**: add a subscriptions store, VAPID keys as Worker
  secrets, a cron trigger in `wrangler.jsonc`, and a `push` handler in `public/sw.js`.
