# Notes for contributors (people and AI)

## What's new (src/changelog.ts)

Every pull request that changes the app adds or extends an entry in
`src/changelog.ts`. Players read it from How to play > What's new, so:

- Write for players, not developers: what they can now do or will notice.
  Work it out from what the PR actually delivers (its description and diff),
  not from commit messages or the PR title.
- One entry per feature. A follow-up fix joins the entry it fixes: add its
  PR number to `prs` rather than writing a new entry.
- Work no player can see (security, monitoring, dashboard, build, CI) goes
  in that day's one-line `behind` note.
- Use the UTC date the PR will merge (usually today). Newest day first,
  newest entry first.
- The PR number isn't known until the PR exists: open the PR, then push the
  number into `prs`.
- CI fails a PR that changes `src/`, `shared/`, `worker/`, `public/` or
  `index.html` without touching `src/changelog.ts`. Label the PR
  `no-changelog` only when nobody could notice the change.

## Interface text

Every new key in `src/locales/en.ts` must be added to all 19 files in
`src/locales/` (the type check fails otherwise).
