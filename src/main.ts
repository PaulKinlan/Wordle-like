import './styles.css';
import { dailyNumber, localDate } from '../shared/daily';
import { checkHardMode, describeViolation, normalizeWord } from '../shared/game';
import { DEFAULT_LANGUAGE, getLanguage, LANGUAGES, orderLanguages } from '../shared/languages';
import { api, ApiError } from './api';
import { Board, renderTracker } from './board';
import { keyboardLanguageHints, NativeEntry } from './keyboard';
import {
  currentStreak,
  loadGame,
  loadSettings,
  loadStats,
  recordResult,
  saveGame,
  saveSettings,
  type Mode,
  type SavedGame,
} from './storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  board: $('board'),
  form: $<HTMLFormElement>('entry-form'),
  input: $<HTMLInputElement>('entry'),
  toast: $('toast'),
  tracker: $('tracker'),
  subtitle: $('subtitle'),
  result: $('result'),
  resultText: $('result-text'),
  btnNew: $<HTMLButtonElement>('btn-new'),
  typeHint: $('type-hint'),
  tabDaily: $<HTMLButtonElement>('mode-daily'),
  tabUnlimited: $<HTMLButtonElement>('mode-unlimited'),
  setHard: $<HTMLInputElement>('set-hard'),
  hardNote: $('hard-note'),
  setContrast: $<HTMLInputElement>('set-contrast'),
  setLang: $<HTMLSelectElement>('set-lang'),
};

const settings = loadSettings();
const board = new Board(els.board);
let game: SavedGame | null = null;
let current = '';
let busy = false;
let lang = settings.lang ?? DEFAULT_LANGUAGE;
const words = new Map<string, { guessable: Set<string>; alphabet: string[] }>();

const entry = new NativeEntry({
  input: els.input,
  form: els.form,
  normalize: (text) => normalizeWord(text, lang),
  onChange: (letters) => {
    current = letters;
    draw();
  },
  onSubmit: () => void submit(),
});

// ---------------------------------------------------------------- game flow

async function startMode(mode: Mode, fresh = false) {
  settings.mode = mode;
  saveSettings(settings);
  els.tabDaily.setAttribute('aria-selected', String(mode === 'daily'));
  els.tabUnlimited.setAttribute('aria-selected', String(mode === 'unlimited'));

  const info = getLanguage(lang) ?? getLanguage(DEFAULT_LANGUAGE)!;
  const saved = fresh ? null : loadGame(lang, mode);
  const today = localDate();

  if (mode === 'daily') {
    game =
      saved && saved.date === today
        ? saved
        : newGame(`d:${today}`, mode, info, { date: today, number: dailyNumber(today) ?? undefined });
  } else {
    game = saved ?? newGame(`r:${randomToken()}`, mode, info);
  }
  saveGame(game);
  current = '';
  entry.clear();
  entry.configure(game.wordLength);
  board.build(game.maxGuesses, game.wordLength);
  draw();
  showResult();
  void loadWords(lang);
}

function newGame(
  puzzle: string,
  mode: Mode,
  info: { code: string; wordLength: number; maxGuesses: number },
  extra: Partial<SavedGame> = {},
): SavedGame {
  return {
    puzzle,
    lang: info.code,
    mode,
    wordLength: info.wordLength,
    maxGuesses: info.maxGuesses,
    hard: settings.hard,
    rows: [],
    status: 'playing',
    ...extra,
  };
}

function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadWords(code: string) {
  if (words.has(code)) return;
  try {
    const list = await api.words(code);
    const letters = new Set<string>();
    for (const w of list) for (const ch of w) letters.add(ch);
    words.set(code, {
      guessable: new Set(list),
      alphabet: [...letters].sort((a, b) => a.localeCompare(b, code)),
    });
    draw();
  } catch {
    // Without the list, the server still validates each guess.
  }
}

async function submit() {
  if (!game || busy || game.status !== 'playing') return;
  const row = game.rows.length;
  const guess = current;
  if ([...guess].length < game.wordLength) return reject(row, 'Not enough letters');

  const list = words.get(game.lang);
  if (list && !list.guessable.has(guess)) return reject(row, 'Not in word list');

  const hard = row === 0 ? settings.hard : game.hard;
  if (hard) {
    const v = checkHardMode(game.rows, guess);
    if (v) return reject(row, describeViolation(v));
  }

  busy = true;
  try {
    const res = await api.play(
      game.lang,
      game.puzzle,
      [...game.rows.map((r) => r.guess), guess],
      hard,
    );
    game.hard = hard;
    game.rows = res.rows;
    game.status = res.status;
    game.answer = res.answer;
    saveGame(game);
    current = '';
    entry.clear();
    if (game.status !== 'playing') entry.setEnabled(false);
    draw(true);
    await board.reveal(row);
    drawTracker();
    if (game.status !== 'playing') finish();
  } catch (e) {
    reject(row, e instanceof ApiError ? e.message : 'Something went wrong');
  } finally {
    busy = false;
  }
}

function reject(row: number, message: string) {
  toast(message);
  board.shake(row);
}

const PRAISE = ['Genius!', 'Magnificent!', 'Impressive!', 'Splendid!', 'Great!', 'Phew!'];

function finish() {
  if (!game) return;
  recordResult(game);
  if (game.status === 'won') {
    board.bounce(game.rows.length - 1);
    toast(PRAISE[Math.min(game.rows.length, PRAISE.length) - 1]);
  } else {
    toast((game.answer ?? '').toLocaleUpperCase(), 3000);
  }
  showResult();
  setTimeout(() => openStats(), 1600);
}

// ---------------------------------------------------------------- drawing

function draw(skipTracker = false) {
  if (!game) return;
  const playing = game.status === 'playing';
  board.render(game.rows, current, playing);
  if (!skipTracker) drawTracker();
  entry.setEnabled(playing);
  els.typeHint.hidden = !playing;

  const info = getLanguage(game.lang);
  const langLabel = LANGUAGES.length > 1 && info ? ` · ${info.nativeName}` : '';
  const hardLabel = game.hard && game.rows.length ? ' · Hard' : '';
  els.subtitle.textContent =
    game.mode === 'daily'
      ? `No. ${game.number ?? '?'} · ${formatDate(game.date)}${langLabel}${hardLabel}`
      : `Play as many as you like${langLabel}${hardLabel}`;
  syncHardSetting();
}

function drawTracker() {
  if (!game) return;
  const alphabet = words.get(game.lang)?.alphabet ?? [...'abcdefghijklmnopqrstuvwxyz'];
  renderTracker(els.tracker, alphabet, game.rows);
}

let countdown: number | undefined;

function showResult() {
  clearInterval(countdown);
  const done = !!game && game.status !== 'playing';
  els.result.hidden = !done;
  if (!game || !done) return;
  const g = game;
  const word = (g.answer ?? '').toLocaleUpperCase();
  const outcome = g.status === 'won' ? `Solved in ${g.rows.length}/${g.maxGuesses}.` : `The word was ${word}.`;
  if (g.mode === 'daily') {
    els.btnNew.textContent = 'Play unlimited';
    const tick = () => {
      els.resultText.textContent = `${outcome} Next word in ${untilMidnight()}`;
    };
    tick();
    countdown = window.setInterval(tick, 1000);
  } else {
    els.btnNew.textContent = 'New word';
    els.resultText.textContent = g.status === 'won' ? `${outcome} The word was ${word}.` : outcome;
  }
}

function untilMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const s = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function formatDate(date?: string) {
  if (!date) return '';
  const d = new Date(date + 'T12:00:00');
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

let toastTimer: number | undefined;
function toast(message: string, ms = 1600) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- dialogs

function openStats() {
  if (!game) return;
  const s = loadStats(game.lang, game.mode, game.maxGuesses);
  const info = getLanguage(game.lang);
  $('stats-scope').textContent = `${game.mode === 'daily' ? 'Daily' : 'Unlimited'} · ${info?.nativeName ?? game.lang}`;
  const today = game.mode === 'daily' ? dailyNumber(localDate()) ?? undefined : undefined;
  const cells: [string, string][] = [
    [String(s.played), 'Played'],
    [s.played ? String(Math.round((s.wins / s.played) * 100)) : '0', 'Win %'],
    [String(currentStreak(s, game.mode, today)), 'Streak'],
    [String(s.maxStreak), 'Best streak'],
  ];
  $('stats-grid').replaceChildren(
    ...cells.map(([value, label]) => {
      const div = document.createElement('div');
      const b = document.createElement('strong');
      b.textContent = value;
      const span = document.createElement('span');
      span.textContent = label;
      div.append(b, span);
      return div;
    }),
  );
  const max = Math.max(1, ...s.dist);
  const highlight = game.status === 'won' ? game.rows.length - 1 : -1;
  $('stats-dist').replaceChildren(
    ...s.dist.map((n, i) => {
      const row = document.createElement('div');
      row.className = 'dist-row';
      const label = document.createElement('span');
      label.textContent = String(i + 1);
      const bar = document.createElement('span');
      bar.className = 'bar' + (i === highlight ? ' hl' : '');
      bar.style.setProperty('--w', `${Math.max(8, (n / max) * 100)}%`);
      bar.textContent = String(n);
      row.append(label, bar);
      return row;
    }),
  );
  openDialog('dlg-stats');
}

function openDialog(id: string) {
  const dlg = $<HTMLDialogElement>(id);
  entry.setEnabled(false);
  dlg.showModal();
  // Start focus on the sheet itself rather than its first button, so the
  // close button doesn't open with a focus ring. Tab reaches it as usual.
  dlg.focus();
}

for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('close', () => draw());
  // Tap outside the sheet to close it.
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
}

function syncHardSetting() {
  const locked = !!game && game.status === 'playing' && game.rows.length > 0;
  els.setHard.checked = locked ? game!.hard : settings.hard;
  els.setHard.disabled = locked;
  els.hardNote.textContent = locked
    ? 'You can change this before your first guess'
    : 'Revealed hints must be used in later guesses';
}

// ---------------------------------------------------------------- wiring

$('btn-help').addEventListener('click', () => openDialog('dlg-help'));
$('btn-stats').addEventListener('click', openStats);
$('btn-settings').addEventListener('click', () => openDialog('dlg-settings'));
els.tabDaily.addEventListener('click', () => void startMode('daily'));
els.tabUnlimited.addEventListener('click', () => void startMode('unlimited'));
els.btnNew.addEventListener('click', () => {
  if (game?.mode === 'daily') void startMode('unlimited');
  else void startMode('unlimited', true);
  entry.focus(true);
});

els.setHard.addEventListener('change', () => {
  settings.hard = els.setHard.checked;
  saveSettings(settings);
  if (game && game.rows.length === 0) {
    game.hard = settings.hard;
    saveGame(game);
  }
});

const applyContrast = () => document.documentElement.classList.toggle('high-contrast', settings.highContrast);
els.setContrast.checked = settings.highContrast;
els.setContrast.addEventListener('change', () => {
  settings.highContrast = els.setContrast.checked;
  saveSettings(settings);
  applyContrast();
});
applyContrast();

els.setLang.addEventListener('change', () => {
  settings.lang = els.setLang.value;
  lang = settings.lang;
  saveSettings(settings);
  void startMode(settings.mode);
});

// A new day brings a new daily word.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && game?.mode === 'daily' && game.date !== localDate()) {
    void startMode('daily');
  }
});

async function chooseLanguage() {
  // Keyboard layout first, then the device's languages, then the rest.
  const hints = await keyboardLanguageHints();
  const order = orderLanguages(
    LANGUAGES.map((l) => l.code),
    navigator.languages ?? [navigator.language],
    hints,
  );
  els.setLang.replaceChildren(
    ...order.map((code) => {
      const info = getLanguage(code)!;
      const o = document.createElement('option');
      o.value = code;
      o.textContent = info.nativeName === info.name ? info.name : `${info.nativeName} (${info.name})`;
      return o;
    }),
  );
  if (!settings.lang) {
    // Use the device's language when we have it; otherwise English.
    const preferred = [...hints, ...(navigator.languages ?? [])].map((t) => t.split('-')[0].toLowerCase());
    lang = order.find((code) => preferred.includes(code)) ?? DEFAULT_LANGUAGE;
  }
  els.setLang.value = lang;
  els.setLang.disabled = LANGUAGES.length < 2;
}

async function init() {
  await chooseLanguage();
  await startMode(settings.mode);
  // On a computer, be ready to type straight away. Phones wait for a tap.
  if (matchMedia('(pointer: fine)').matches) entry.focus(false);
  if (firstVisit()) openDialog('dlg-help');
}

function firstVisit() {
  try {
    if (localStorage.getItem('letterly:v1:seen-help')) return false;
    localStorage.setItem('letterly:v1:seen-help', '1');
  } catch {
    return false;
  }
  return true;
}

void init();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // The CSP requires Trusted Types; this policy only ever allows our own worker.
  type TT = { createPolicy(n: string, p: { createScriptURL(u: string): string }): { createScriptURL(u: string): string } };
  const tt = (window as unknown as { trustedTypes?: TT }).trustedTypes;
  const url = tt
    ? tt.createPolicy('sw', {
        createScriptURL: (u) => {
          if (u !== '/sw.js') throw new TypeError('Unexpected service worker URL');
          return u;
        },
      }).createScriptURL('/sw.js')
    : '/sw.js';
  addEventListener('load', () => void navigator.serviceWorker.register(url as string));
}
