// What's new: the player-facing change log, shown from How to play.
//
// This is NOT a commit log. Each entry says what a player can now do or
// will notice, in plain words, worked out from what the pull request
// actually delivered (its description and diff), not from its title.
//
// Every pull request that changes the app adds or extends an entry here
// (CI checks; label a PR `no-changelog` for changes nobody can notice).
// - Newest day first, newest entry first within a day. Dates are the UTC
//   day the PR merged.
// - One entry per feature, not per PR: a follow-up fix joins the entry it
//   fixes (add its PR number to `prs`).
// - Work players can't see (security, monitoring, dashboard, build) goes
//   in the day's one-line `behind` note, not in its own entry.
// - English only for now; the dialog around it is translated.

export interface ChangeEntry {
  title: string;
  /** One or two short sentences, written for players. */
  text: string;
  /** The pull requests that delivered it, linked from the entry. */
  prs: number[];
}

export interface ChangeDay {
  /** YYYY-MM-DD, the UTC day the work went live. */
  date: string;
  entries: ChangeEntry[];
  /** One line on the behind-the-scenes work that day, if any. */
  behind?: string;
}

export const CHANGELOG: ChangeDay[] = [
  {
    date: '2026-11-15',
    entries: [
      {
        title: 'A change log, right here',
        text: "You're reading it: a list of what has changed, linked from How to play. A small dot on the ? button tells you when there's something you haven't seen.",
        prs: [40],
      },
      {
        title: 'A better fit in the installed app',
        text: "On Android the installed app no longer slides under the navigation bar, so the result panel stays in view, and the board uses the screen's real height with bigger tiles. How to play has a Debug log link to help us track down problems.",
        prs: [41],
      },
      {
        title: 'No offensive answers',
        text: 'Slurs and offensive words are never picked as the answer, in any language. They still count as guesses.',
        prs: [41],
      },
      {
        title: 'A rounder, smoother look in newer Chrome',
        text: 'Tiles, keys and sheets get soft squircle corners, a win throws a little confetti, and the board slides when you switch modes. Long-press a letter in the letter strip to see what you know about it. The language pickers list your own languages first, each shown in its own language and in English, and text follows your phone\'s font size without squeezing the board.',
        prs: [39],
      },
    ],
    behind: 'Every update now has to come with a note on this page.',
  },
  {
    date: '2026-11-14',
    entries: [
      {
        title: 'Install Letterle as an app',
        text: "Settings has an Install button, and a small Install link appears after a game. After your second game we'll offer it once; Not now hides the offer for 30 days. On iPhone it shows the Share, then Add to Home Screen steps.",
        prs: [38],
      },
      {
        title: 'Skip a word in Unlimited',
        text: "Stuck? Tap Skip next to the date, then tap again to confirm. You'll see the word you skipped, and a skip doesn't count in your stats.",
        prs: [35],
      },
      {
        title: 'An Enter button on the row',
        text: "When a row is full, a round ↵ button appears beside it, so you don't have to hunt for Enter on your keyboard. The row you're typing stands out more, and when the keyboard is down the next tile gently pulses to show where to tap.",
        prs: [34],
      },
      {
        title: 'Faster all round',
        text: 'Guesses come back quicker, typing and tile flips are smoother on slower phones, the game opens faster on a weak signal, and updates download only what changed. The "new version is ready" bar now shows up when it should.',
        prs: [32, 33],
      },
      {
        title: 'The keyboard opens and closes properly',
        text: "One tap on the board brings up your phone's keyboard, and it goes away when the game ends or you tap elsewhere, so it no longer sits on top of your stats.",
        prs: [24, 28],
      },
      {
        title: 'Better race rooms',
        text: 'The host can cancel a race, or get a new code so the old invite stops working. If the host leaves, the next player takes over, and anyone who leaves frees their seat for someone new.',
        prs: [29],
      },
      {
        title: 'Game and reminder fixes',
        text: 'A guess can no longer land on the wrong game if you switch mode while it is sent. A game you close during the tile flip still counts in your stats. Daily moves to the new word at midnight, How to play shows the right number of tries for each language, and reminders arrive closer to the time you chose.',
        prs: [30, 31],
      },
      {
        title: 'Optional on-screen keyboard',
        text: "Prefer tapping keys? Turn on On-screen keyboard in Settings. Keys are coloured by what you've found, with a layout for every language, including Welsh double-letter keys, Korean and a Japanese kana grid. It's off by default; your phone's keyboard stays the main way to play.",
        prs: [25, 27],
      },
      {
        title: 'Hints while you type',
        text: "Letters you've already tried are marked in the row you're typing: struck through if they're not in the word, a dot if they're somewhere in it, a bar if they belong right there. You can turn this off in Settings.",
        prs: [22, 25],
      },
      {
        title: 'Menus in 12 more languages',
        text: 'The menus, help and reminders are now available in Catalan, Basque, Welsh, Irish, Scottish Gaelic, Breton, Polish, Swedish, Turkish, Greek, Japanese and Korean.',
        prs: [23],
      },
      {
        title: 'Japanese and Korean words',
        text: 'Japanese uses 4 kana and gives you 8 tries; type in hiragana or katakana. Korean uses 6 tiles, one per key, so 한국 is ㅎ ㅏ ㄴ ㄱ ㅜ ㄱ.',
        prs: [21],
      },
      {
        title: 'Welsh, Irish and Scottish Gaelic words',
        text: "In Welsh, double letters like ll, dd and ch fill one tile, as they're one letter. In dark mode the installed app on Android gets a dark navigation bar.",
        prs: [20],
      },
      {
        title: 'Seven more word languages',
        text: 'Play in Catalan, Basque, Breton, Polish, Swedish, Turkish or Greek, each with its own special letters.',
        prs: [18],
      },
      {
        title: 'Link previews and race alerts',
        text: "A shared result shows a picture of your grid (never the letters), and a race invite shows its code. In a race lobby, tap \"Tell me when a friend joins\" to get a notification. A bar lets you know when a new version is ready, and switching between light and dark fades smoothly.",
        prs: [17],
      },
      {
        title: 'Light, dark or automatic',
        text: 'Pick Auto, Light or Dark under Appearance in Settings. Messages now show above an open sheet instead of behind it.',
        prs: [15],
      },
      {
        title: 'Report a bug',
        text: 'How to play has a "Found a bug?" link that opens a report with the details filled in (never the answer). Settings shows the version you\'re running.',
        prs: [14],
      },
      {
        title: 'Reminders you can act on',
        text: 'Turning on reminders works in newer Chrome. Reminders show a picture and have Play, Snooze 1 hour and Race a friend buttons.',
        prs: [12, 13],
      },
      {
        title: 'letterle.app',
        text: "The game has its own address. Daily reminders work straight away, the keyboard closes when you're not typing, and the share picture is bigger, with your score, streak and a link.",
        prs: [10, 11],
      },
      {
        title: 'Menus in your language',
        text: "A new Interface language setting, separate from the word language, so you can play Spanish words with English menus or the other way round. Menus are in Spanish, French, German, Italian, Portuguese and Dutch.",
        prs: [8],
      },
      {
        title: 'Daily reminders, streaks and a share picture',
        text: "Turn on a daily reminder in Settings and pick the time; it skips days you've already played. Your streak shows after the daily word, and Share sends a picture of your grid.",
        prs: [7],
      },
      {
        title: 'Race your friends',
        text: 'Start a race, send the invite, and everyone plays the same word. When someone finishes a row, the others have 5 seconds to finish theirs. First to find the word wins; otherwise the best row wins, with 2 points for each green and 1 for each yellow.',
        prs: [6],
      },
      {
        title: 'Six more languages',
        text: 'Play in Spanish, French, German, Italian, Portuguese or Dutch. Accents are optional (É counts as E), but letters like Ñ and Ä count as their own letter.',
        prs: [5],
      },
      {
        title: 'Share, and a harder hard mode',
        text: 'Share your result without giving the word away. Hard mode now picks rarer words and has its own daily word and stats.',
        prs: [4],
      },
      {
        title: 'Letterle is here',
        text: "A new word every day, the same for everyone, plus Unlimited for as many as you like. Type with your phone's own keyboard, track your stats and streaks, play offline, and add it to your home screen.",
        prs: [1, 2, 3],
      },
    ],
    behind:
      'Answers stay private on the server and future words can\'t be peeked at, limits keep the game safe from abuse, a private dashboard watches for errors and slowness without cookies or third parties, each language has its own page for search engines, and AI agents in the browser can try playing.',
  },
];

/** The newest day with an entry: what "seen" is measured against. */
export const LATEST = CHANGELOG[0]?.date ?? '';
