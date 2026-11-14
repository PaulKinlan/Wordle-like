import './styles.css';
import { dailyNumber, localDate } from '../shared/daily';
import { checkHardMode, normalizeWord, type HardModeViolation } from '../shared/game';
import { DEFAULT_LANGUAGE, getLanguage, LANGUAGES, orderLanguages } from '../shared/languages';
import { api, ApiError } from './api';
import { Board, renderTracker, setTileLocale, toUpper } from './board';
import { setUiLanguage, t, translatePage, uiLang, UI_LANGUAGES } from './i18n';
import { keyboardLanguageHints, NativeEntry } from './keyboard';
import { RaceClient } from './race';
import { initDebug } from './debug';
import { initTelemetry, track } from './telemetry';
import { watchForUpdates } from './update';
import { registerAgentTools } from './webmcp';
import { canVibrate, promptInstall, setHaptics, setUnplayedBadge, watchInstall } from './pwa';
import { COMMIT, COMMIT_URL, REPO_URL, SHORT_COMMIT } from '../shared/version';
import { disablePush, enablePush, loadPushPrefs, markPlayedToday, pushAvailability } from './push';
import { resultUrl, shareCard, shareText, streakLine } from './share';
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

// First, so errors during start-up are caught too.
initTelemetry();

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
  btnShare: $<HTMLButtonElement>('btn-share'),
  statsShare: $<HTMLButtonElement>('stats-share'),
  typeHint: $('type-hint'),
  tabDaily: $<HTMLButtonElement>('mode-daily'),
  tabUnlimited: $<HTMLButtonElement>('mode-unlimited'),
  tabRace: $<HTMLButtonElement>('mode-race'),
  setHard: $<HTMLInputElement>('set-hard'),
  setContrast: $<HTMLInputElement>('set-contrast'),
  setLang: $<HTMLSelectElement>('set-lang'),
};

const settings = loadSettings();
const board = new Board(els.board);
let game: SavedGame | null = null;
let current = '';
let busy = false;
/** A language landing page (/es/, /fr/, ...) sets the word and interface language until the player picks their own. */
// A shared result (/s/es/...) opens in the language it was played in.
const pageLang = /^\/(?:s\/)?([a-z]{2,3})(?:\/|$)/.exec(location.pathname)?.[1];
const pathLang = pageLang && getLanguage(pageLang) ? pageLang : null;
let lang = settings.lang ?? pathLang ?? DEFAULT_LANGUAGE;
const words = new Map<string, Set<string>>();

const entry = new NativeEntry({
  input: els.input,
  form: els.form,
  normalize: (text) => normalizeWord(text, lang),
  onChange: (letters) => {
    if (race.isActive) return race.onLetters(letters);
    current = letters;
    draw();
  },
  onSubmit: () => (race.isActive ? race.submit() : void submit()),
});

const race = new RaceClient({
  board,
  entry,
  tracker: els.tracker,
  toast: (m, ms) => toast(m, ms),
  openDialog: (id) => openDialog(id),
  config: () => ({ lang, hard: settings.hard }),
  setSubtitle: (text) => {
    els.subtitle.textContent = text;
  },
  describeViolation: (v) => describeViolation(v),
  words: (code) => words.get(code),
  loadWords: (code) => void loadWords(code),
});

function selectTab(tab: 'daily' | 'unlimited' | 'race') {
  els.tabDaily.setAttribute('aria-selected', String(tab === 'daily'));
  els.tabUnlimited.setAttribute('aria-selected', String(tab === 'unlimited'));
  els.tabRace.setAttribute('aria-selected', String(tab === 'race'));
}

function openRace(code?: string | null) {
  selectTab('race');
  els.result.hidden = true;
  els.typeHint.hidden = true;
  race.show(code);
}

// ---------------------------------------------------------------- game flow

async function startMode(mode: Mode, fresh = false) {
  if (race.isActive) race.hide();
  settings.mode = mode;
  saveSettings(settings);
  selectTab(mode);

  const info = getLanguage(lang) ?? getLanguage(DEFAULT_LANGUAGE)!;
  const hard = settings.hard;
  const saved = fresh ? null : loadGame(lang, mode, hard);
  const today = localDate();
  const h = hard ? 'h' : '';

  if (mode === 'daily') {
    game =
      saved && saved.date === today
        ? saved
        : newGame(`d${h}:${today}`, mode, info, { date: today, number: dailyNumber(today) ?? undefined });
  } else {
    game = saved ?? newGame(`r${h}:${randomToken()}`, mode, info);
  }
  // Hard mode is part of the puzzle id.
  game.hard = /^[dr]h:/.test(game.puzzle);
  saveGame(game);
  current = '';
  entry.clear();
  entry.configure(game.wordLength);
  // Hints the phone's keyboard towards the game's language, where supported.
  els.input.lang = game.lang;
  setTileLocale(game.lang);
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
    words.set(code, new Set(list));
    draw();
  } catch {
    // Without the list, the server still validates each guess.
  }
}

async function submit() {
  if (!game || busy || game.status !== 'playing') return;
  const row = game.rows.length;
  const guess = current;
  if ([...guess].length < game.wordLength) return reject(row, t('err.short'));

  const list = words.get(game.lang);
  if (list && !list.has(guess)) return reject(row, t('err.notWord'));

  if (game.hard) {
    const v = checkHardMode(game.rows, guess);
    if (v) return reject(row, describeViolation(v));
  }

  busy = true;
  try {
    const res = await api.play(game.lang, game.puzzle, [...game.rows.map((r) => r.guess), guess]);
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
    reject(row, e instanceof ApiError ? apiMessage(e) : t('err.generic'));
  } finally {
    busy = false;
  }
}

/** Messages for errors the server sends back, in the interface language. */
function apiMessage(e: ApiError) {
  if (e.code === 'hard_mode' && e.violation) return describeViolation(e.violation);
  if (e.code === 'not_in_list') return t('err.notWord');
  if (e.code === 'wrong_length') return t('err.short');
  if (e.code === 'offline') return t('err.offline');
  return e.message;
}

function describeViolation(v: HardModeViolation) {
  const letter = toUpper(v.letter);
  if (v.kind === 'position') return t('err.position', { n: v.position + 1, letter });
  return v.count > 1 ? t('err.includeMany', { count: v.count, letter }) : t('err.include', { letter });
}

function upperWord(word: string, code: string) {
  return [...word].map((c) => (c === 'ß' ? 'ẞ' : c.toLocaleUpperCase(code))).join('');
}

/** The last refusal, so an agent (webmcp.ts) can be told why its guess didn't count. */
let lastReject: string | null = null;

function reject(row: number, message: string) {
  lastReject = message;
  toast(message);
  board.shake(row);
}


function finish() {
  if (!game) return;
  recordResult(game);
  if (game.mode === 'daily') updateBadge();
  if (game.mode === 'daily' && game.date) void markPlayedToday(game.date);
  if (game.status === 'won') {
    board.bounce(game.rows.length - 1);
    toast(t(`praise.${Math.min(game.rows.length, 6)}` as 'praise.1'));
  } else {
    toast(upperWord(game.answer ?? '', game.lang), 3000);
  }
  showResult();
  setTimeout(() => openStats(), 1600);
}

// ---------------------------------------------------------------- drawing

function draw(skipTracker = false) {
  if (!game || race.isActive) return;
  const playing = game.status === 'playing';
  board.render(game.rows, current, playing);
  if (!skipTracker) drawTracker();
  entry.setEnabled(playing);
  els.typeHint.hidden = !playing;

  const info = getLanguage(game.lang);
  const langLabel = LANGUAGES.length > 1 && info ? ` · ${info.nativeName}` : '';
  const hardLabel = game.hard ? ` · ${t('sub.hard')}` : '';
  els.subtitle.textContent =
    game.mode === 'daily'
      ? `${t('sub.daily', { n: game.number ?? '?', date: formatDate(game.date) })}${langLabel}${hardLabel}`
      : `${t('sub.unlimited')}${langLabel}${hardLabel}`;
  syncHardSetting();
}

function drawTracker() {
  if (!game || race.isActive) return;
  const alphabet = [...(getLanguage(game.lang)?.alphabet ?? 'abcdefghijklmnopqrstuvwxyz')];
  renderTracker(els.tracker, alphabet, game.rows);
}

let countdown: number | undefined;

function showResult() {
  clearInterval(countdown);
  const done = !!game && game.status !== 'playing';
  els.result.hidden = !done;
  if (!game || !done) return;
  const g = game;
  const word = upperWord(g.answer ?? '', g.lang);
  const outcome = g.status === 'won' ? t('result.solved', { n: g.rows.length, max: g.maxGuesses }) : t('result.was', { word });
  if (g.mode === 'daily') {
    els.btnNew.textContent = t('playUnlimited');
    const stats = loadStats(g.lang, g.mode, g.hard, g.maxGuesses);
    const fire = streakLine(g, currentStreak(stats, g.mode, g.number));
    const tick = () => {
      els.resultText.textContent = `${outcome}${fire ? ` ${fire}.` : ''} ${t('result.next', { time: untilMidnight() })}`;
    };
    tick();
    countdown = window.setInterval(tick, 1000);
  } else {
    els.btnNew.textContent = t('newWord');
    els.resultText.textContent = g.status === 'won' ? `${outcome} ${t('result.was', { word })}` : outcome;
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
  return d.toLocaleDateString(uiLang(), { day: 'numeric', month: 'short', year: 'numeric' });
}

let toastTimer: number | undefined;
function toast(message: string, ms = 1600) {
  const el = els.toast;
  el.textContent = message;
  clearTimeout(toastTimer);
  if ('showPopover' in el) {
    // Re-open so it lands above any dialog opened since; place it at the top of the board area.
    const top = el.parentElement?.getBoundingClientRect().top ?? 0;
    el.style.setProperty('--toast-top', `${Math.max(8, top + 8)}px`);
    if (el.matches(':popover-open')) el.hidePopover();
    el.showPopover();
    el.getBoundingClientRect(); // start the fade from hidden
  }
  el.classList.add('show');
  toastTimer = window.setTimeout(() => {
    el.classList.remove('show');
    toastTimer = window.setTimeout(() => el.matches(':popover-open') && el.hidePopover(), 200);
  }, ms);
}

// ---------------------------------------------------------------- dialogs

function openStats() {
  if (!game) return;
  const s = loadStats(game.lang, game.mode, game.hard, game.maxGuesses);
  const info = getLanguage(game.lang);
  $('stats-scope').textContent = [
    game.mode === 'daily' ? t('mode.daily') : t('mode.unlimited'),
    game.hard ? t('sub.hard') : '',
    info?.nativeName ?? game.lang,
  ]
    .filter(Boolean)
    .join(' · ');
  els.statsShare.hidden = game.status === 'playing';
  const today = game.mode === 'daily' ? dailyNumber(localDate()) ?? undefined : undefined;
  const cells: [string, string][] = [
    [String(s.played), t('stats.played')],
    [s.played ? String(Math.round((s.wins / s.played) * 100)) : '0', t('stats.win')],
    [String(currentStreak(s, game.mode, today)), t('stats.streak')],
    [String(s.maxStreak), t('stats.best')],
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
  dlg.addEventListener('close', () => (race.isActive ? race.show() : draw()));
  // Tap outside the sheet to close it.
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
}

function syncHardSetting() {
  els.setHard.checked = settings.hard;
}

// ---------------------------------------------------------------- wiring

$('btn-help').addEventListener('click', () => {
  track('open_help');
  openDialog('dlg-help');
});
$('btn-stats').addEventListener('click', () => {
  track('open_stats');
  openStats();
});
$('btn-settings').addEventListener('click', () => openDialog('dlg-settings'));
els.tabDaily.addEventListener('click', () => void startMode('daily'));
els.tabUnlimited.addEventListener('click', () => void startMode('unlimited'));
els.tabRace.addEventListener('click', () => openRace());
els.btnNew.addEventListener('click', () => {
  track('new_word');
  if (game?.mode === 'daily') void startMode('unlimited');
  else void startMode('unlimited', true);
  entry.focus(true);
});

// Hard mode is a separate puzzle with its own saved game, so switching never
// loses progress: each side picks up where it was left.
els.setHard.addEventListener('change', () => {
  track('setting', { hard: els.setHard.checked });
  settings.hard = els.setHard.checked;
  saveSettings(settings);
  if (race.isActive) race.show(); // applies to the next race you start
  else void startMode(settings.mode);
});

els.btnShare.addEventListener('click', () => void share());
els.statsShare.addEventListener('click', () => void share());

async function share() {
  if (!game || game.status === 'playing') return;
  const g = game;
  const stats = loadStats(g.lang, g.mode, g.hard, g.maxGuesses);
  const streak = currentStreak(stats, g.mode, g.mode === 'daily' ? (dailyNumber(localDate()) ?? undefined) : undefined);
  const text = shareText(g, settings.highContrast, resultUrl(g, location.origin), streak);
  try {
    // A picture of the grid where the share sheet takes files, with the text alongside.
    const blob = 'canShare' in navigator ? await shareCard(
          g,
          settings.highContrast,
          { won: t('card.won'), lost: t('card.lost'), play: t('card.play', { host: location.host }) },
          streak,
        ) : null;
    const file = blob ? new File([blob], 'letterle.png', { type: 'image/png' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      track('share', { method: 'image' });
      return;
    }
    if (navigator.share && navigator.canShare?.({ text }) !== false) {
      await navigator.share({ text });
      track('share', { method: 'text' });
      return;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return; // closed the share sheet
  }
  try {
    await navigator.clipboard.writeText(text);
    track('share', { method: 'clipboard' });
    toast(t('share.copied'));
  } catch {
    toast(t('share.failed'));
  }
}

const applyContrast = () => document.documentElement.classList.toggle('high-contrast', settings.highContrast);
els.setContrast.checked = settings.highContrast;
els.setContrast.addEventListener('change', () => {
  settings.highContrast = els.setContrast.checked;
  track('setting', { contrast: settings.highContrast });
  saveSettings(settings);
  applyContrast();
});
applyContrast();

// Appearance: Auto (follow the system), Light or Dark. public/theme.js applies
// the saved choice before first paint; this keeps it in step when changed.
type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'letterle:theme';
const THEME_COLORS = { light: '#f6f6f3', dark: '#121316' };
function savedTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    // Each meta has a media query for its scheme; with a fixed theme both say the same colour.
    const own = m.media.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light;
    m.content = theme === 'system' ? own : THEME_COLORS[theme];
  }
  document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')!.content = theme === 'system' ? 'light dark' : theme;
}
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="theme"]')) {
  radio.checked = radio.value === savedTheme();
  radio.addEventListener('change', () => {
    const theme = radio.value as Theme;
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode: still applies for this visit */
    }
    // A cross-fade between the old colours and the new (View Transitions), unless motion is reduced.
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.classList.add('theme-fade');
      const vt = doc.startViewTransition(() => applyTheme(theme)) as { finished: Promise<void> };
      void vt.finished.finally(() => document.documentElement.classList.remove('theme-fade'));
    } else applyTheme(theme);
    track('setting', { theme });
  });
}
applyTheme(savedTheme());

// Vibration (Android): on unless turned off.
const setHapticsBox = $<HTMLInputElement>('set-haptics');
setHaptics(settings.haptics !== false);
setHapticsBox.checked = settings.haptics !== false;
$('haptics-row').hidden = !canVibrate();
setHapticsBox.addEventListener('change', () => {
  track('setting', { haptics: setHapticsBox.checked });
  settings.haptics = setHapticsBox.checked;
  saveSettings(settings);
  setHaptics(setHapticsBox.checked);
});

// Install button, where the browser offers one (Chrome, Edge, Samsung).
watchInstall((available) => ($('install-row').hidden = !available));
$('btn-install').addEventListener('click', () => {
  track('install_prompt');
  void promptInstall().then((accepted) => {
    track(accepted ? 'install_accepted' : 'install_dismissed');
    $('install-row').hidden = true;
  });
});

/** A dot on the app icon while today's word (in the current language and mode) is unplayed. */
function updateBadge() {
  const g = loadGame(lang, 'daily', settings.hard);
  setUnplayedBadge(!(g && g.date === localDate() && g.status !== 'playing'));
}

els.setLang.addEventListener('change', () => {
  settings.lang = els.setLang.value;
  track('setting', { lang: settings.lang });
  lang = settings.lang;
  saveSettings(settings);
  if (race.isActive) race.show();
  else void startMode(settings.mode);
});

// ---------------------------------------------------------------- reminders

const pushRow = $('push-row');
const pushHourRow = $('push-hour-row');
const pushSwitch = $<HTMLInputElement>('set-push');
const pushHour = $<HTMLSelectElement>('set-push-hour');

async function setupReminders() {
  const availability = await pushAvailability();
  if (availability === 'unsupported' || availability === 'off') return;
  pushRow.hidden = false;
  if (availability === 'install-first') {
    $('push-note').dataset.i18n = 'settings.pushInstall';
    $('push-note').textContent = t('settings.pushInstall');
    pushSwitch.disabled = true;
    return;
  }
  pushHour.replaceChildren(
    ...Array.from({ length: 24 }, (_, h) => {
      const o = document.createElement('option');
      o.value = String(h);
      o.textContent = new Date(2000, 0, 1, h).toLocaleTimeString(uiLang(), { hour: 'numeric', minute: '2-digit' });
      return o;
    }),
  );
  const prefs = loadPushPrefs();
  pushSwitch.checked = !!prefs && Notification.permission === 'granted';
  pushHour.value = String(prefs?.hour ?? 9);
  pushHourRow.hidden = !pushSwitch.checked;
}

async function updateReminders() {
  pushSwitch.disabled = true;
  try {
    if (pushSwitch.checked) {
      const problem = await enablePush(Number(pushHour.value), lang, uiLang());
      track(problem ? 'reminders_failed' : 'reminders_on', { problem, hour: Number(pushHour.value) });
      if (problem) {
        pushSwitch.checked = false;
        toast(t(problem), 3000);
      } else {
        toast(t('push.set', { time: pushHour.selectedOptions[0]?.textContent ?? '' }));
      }
    } else {
      track('reminders_off');
      await disablePush();
    }
  } finally {
    pushSwitch.disabled = false;
    pushHourRow.hidden = !pushSwitch.checked;
  }
}

pushSwitch.addEventListener('change', () => void updateReminders());
pushHour.addEventListener('change', () => {
  if (pushSwitch.checked) void updateReminders();
});

// A new day brings a new daily word.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !race.isActive && game?.mode === 'daily' && game.date !== localDate()) {
    void startMode('daily');
  }
});

// ---------------------------------------------------------------- interface language

const UI_KEY = 'letterly:v1:ui-lang';
const setUiLang = $<HTMLSelectElement>('set-ui-lang');

function savedUiLang(): string | null {
  try {
    return localStorage.getItem(UI_KEY);
  } catch {
    return null;
  }
}

/** Offers the device's languages first, but stays in English unless chosen. */
function fillUiLanguages(hints: string[]) {
  const order = orderLanguages(
    UI_LANGUAGES.map((l) => l.code),
    navigator.languages ?? [navigator.language],
    hints,
  );
  setUiLang.replaceChildren(
    ...order.map((code) => {
      const info = UI_LANGUAGES.find((l) => l.code === code)!;
      const o = document.createElement('option');
      o.value = code;
      o.textContent = info.nativeName === info.name ? info.name : `${info.nativeName} (${info.name})`;
      return o;
    }),
  );
  setUiLang.value = uiLang();
}

async function applyUiLanguage(code: string) {
  track('setting', { ui: code });
  await setUiLanguage(code);
  translatePage();
  setUiLang.value = uiLang();
  if (race.isActive) race.show();
  else {
    draw();
    showResult();
  }
  // Reminders are written in the interface language: update the server's copy.
  await setupReminders();
  if (pushSwitch.checked) void enablePush(Number(pushHour.value), lang, uiLang());
}

setUiLang.addEventListener('change', () => {
  try {
    localStorage.setItem(UI_KEY, setUiLang.value);
  } catch {
    /* private mode: applies to this visit */
  }
  void applyUiLanguage(setUiLang.value);
});

async function chooseLanguage() {
  // Keyboard layout first, then the device's languages, then the rest.
  const hints = await keyboardLanguageHints();
  fillUiLanguages(hints);
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
  // English unless the player picks another: the device's languages are only
  // offered first in the list.
  els.setLang.value = lang;
  els.setLang.disabled = LANGUAGES.length < 2;
}

async function init() {
  initDebug();
  // A shared result link has done its job once the game is open.
  if (location.pathname.startsWith('/s/')) history.replaceState(null, '', '/');
  showVersion();
  const ui = savedUiLang() ?? pathLang;
  if (ui && ui !== 'en') {
    await setUiLanguage(ui);
    translatePage();
  }
  void setupReminders();
  await chooseLanguage();
  await startMode(settings.mode);
  // An invite link (/?race=CODE) opens the race straight away.
  const invited = RaceClient.codeFromUrl();
  if (invited) {
    openRace(invited);
    return;
  }
  updateBadge();
  // Reminder buttons and app shortcuts open /?play=daily, unlimited or race.
  const play = new URLSearchParams(location.search).get('play');
  if (play === 'daily' || play === 'unlimited' || play === 'race') {
    history.replaceState(null, '', location.pathname);
    openFromReminder(play);
    return;
  }
  // On a computer, be ready to type straight away. Phones wait for a tap.
  if (matchMedia('(pointer: fine)').matches) entry.focus(false);
  if (firstVisit()) openDialog('dlg-help');
}

function showVersion() {
  const a = $<HTMLAnchorElement>('app-version');
  a.href = COMMIT_URL;
  a.textContent = t('settings.version', { version: SHORT_COMMIT });
}

/** A new GitHub issue, filled in with what's useful for fixing it (never the answer). */
function bugReportUrl() {
  const g = game;
  const ua = navigator.userAgent;
  const body = [
    '**What happened?**',
    '',
    '',
    '**What did you expect?**',
    '',
    '',
    '---',
    `- Version: ${COMMIT}`,
    `- Page: ${location.origin}${location.pathname}`,
    `- Mode: ${race.isActive ? 'race' : (g?.mode ?? '?')}${g?.hard ? ' (hard)' : ''}, word language ${g?.lang ?? '?'}, interface ${uiLang()}`,
    `- Browser: ${ua}`,
    `- Screen: ${screen.width}x${screen.height}, installed: ${matchMedia('(display-mode: standalone)').matches}`,
  ].join('\n');
  const url = new URL(`${REPO_URL}/issues/new`);
  url.searchParams.set('title', 'Bug: ');
  url.searchParams.set('body', body);
  url.searchParams.set('labels', 'bug');
  return url.href;
}

// Built when tapped, so it describes the game as it is then.
$<HTMLAnchorElement>('report-bug').addEventListener('click', (e) => {
  track('report_bug');
  (e.currentTarget as HTMLAnchorElement).href = bugReportUrl();
});

function openFromReminder(play: 'daily' | 'unlimited' | 'race') {
  for (const dlg of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) dlg.close();
  if (play === 'race') openRace();
  else void startMode(play);
}

// The service worker asks an open tab to show what a reminder button picked.
navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
  const play = (e.data as { type?: string; play?: string } | null)?.play;
  if ((e.data as { type?: string })?.type === 'play' && (play === 'daily' || play === 'unlimited' || play === 'race')) {
    openFromReminder(play);
  }
});

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

// An AI agent can play too, where the browser supports WebMCP (an experiment).
registerAgentTools({
  state: () =>
    game && !race.isActive
      ? {
          mode: game.mode,
          language: { code: game.lang, name: getLanguage(game.lang)?.name ?? game.lang },
          puzzleNumber: game.number,
          wordLength: game.wordLength,
          maxGuesses: game.maxGuesses,
          hardMode: game.hard,
          status: game.status,
          rows: game.rows.map((r) => ({ guess: r.guess, marks: r.marks })),
          ...(game.status === 'playing' ? {} : { answer: game.answer }),
        }
      : null,
  async guess(word) {
    if (race.isActive) return 'A race is open; agents can play the daily or unlimited game.';
    if (!game || game.status !== 'playing') return 'This game is over. Start another with new_game.';
    if (busy) return 'Still checking the last guess.';
    for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) d.close();
    current = [...normalizeWord(word, game.lang)].slice(0, game.wordLength).join('');
    draw();
    lastReject = null;
    await submit();
    return lastReject;
  },
  async newGame(mode) {
    for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) d.close();
    await startMode(mode, mode === 'unlimited' && game?.mode === 'unlimited' && game.status !== 'playing');
  },
  used: (tool) => track('agent_tool', { tool }),
});

// A newer version is live: offer it, without interrupting anything.
watchForUpdates((live) => {
  const bar = $('update-bar');
  bar.hidden = false;
  track('update_offered', { from: COMMIT.slice(0, 7), to: live.slice(0, 7) });
  $('btn-update').addEventListener('click', () => {
    track('update_applied');
    location.reload();
  });
});

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
