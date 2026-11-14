// Multiplayer race, client side. Talks to the room's Durable Object over a
// WebSocket and draws the lobby, the other players' colours, the row clock
// and the results. The board and the native keyboard entry are shared with
// solo play (main.ts hands them over while the Race tab is open).
import { checkHardMode, type HardModeViolation, type Mark } from '../shared/game';
import { getLanguage } from '../shared/languages';
import {
  ROOM_CODE,
  ROW_SECONDS,
  type ClientMessage,
  type RaceState,
  type ServerMessage,
} from '../shared/race';
import type { Board } from './board';
import { renderTracker, toUpper } from './board';
import { t, uiLang, type MessageKey } from './i18n';
import type { NativeEntry } from './keyboard';
import { keepAwake } from './pwa';
import { track } from './telemetry';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const KEY = 'letterly:v1:';
const store = {
  get(k: string) {
    try {
      return localStorage.getItem(KEY + k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(KEY + k);
      else localStorage.setItem(KEY + k, v);
    } catch {
      /* private mode */
    }
  },
};

export interface RaceHost {
  board: Board;
  entry: NativeEntry;
  tracker: HTMLElement;
  toast(message: string, ms?: number): void;
  openDialog(id: string): void;
  /** Settings for a new race. */
  config(): { lang: string; hard: boolean };
  /** The subtitle under the tabs. */
  setSubtitle(text: string): void;
  /** A hard mode rule broken, in the interface language. */
  describeViolation(v: HardModeViolation): string;
  /** Words the client knows are valid, if loaded. */
  words(lang: string): Set<string> | undefined;
  loadWords(lang: string): void;
}

const ERRORS: Record<string, MessageKey> = {
  not_host: 'race.notHost',
  need_players: 'race.needPlayers',
  room_full: 'race.full',
  server_error: 'err.generic',
};

export class RaceClient {
  private ws?: WebSocket;
  private code: string | null = null;
  private me: string | null = null;
  private state?: RaceState;
  /** Server clock minus ours, from the last state message. */
  private skew = 0;
  private current = '';
  private active = false;
  private retry = 0;
  private retryTimer?: number;
  private pingTimer?: number;
  private timerFrame?: number;
  private shownResultRound = 0;
  private builtShape = '';
  private sending = false;

  private els = {
    lobby: $('race-lobby'),
    intro: $('race-intro'),
    room: $('race-room'),
    name: $<HTMLInputElement>('race-name'),
    create: $<HTMLButtonElement>('race-create'),
    config: $('race-config'),
    code: $('race-code'),
    roomConfig: $('race-room-config'),
    invite: $<HTMLButtonElement>('race-invite'),
    players: $('race-players'),
    start: $<HTMLButtonElement>('race-start'),
    wait: $('race-wait'),
    leave: $<HTMLButtonElement>('race-leave'),
    bar: $('race-bar'),
    opponents: $('opponents'),
    timer: $('race-timer'),
    timerFill: $('race-timer-fill'),
    timerText: $('race-timer-text'),
    boardWrap: $('entry-form'),
    outcome: $('race-outcome'),
    standings: $('race-standings'),
    again: $<HTMLButtonElement>('race-again'),
    againNote: $('race-again-note'),
  };

  constructor(private host: RaceHost) {
    const e = this.els;
    e.name.value = store.get('name') ?? '';
    e.create.addEventListener('click', () => void this.createOrJoin());
    e.name.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') void this.createOrJoin();
    });
    e.invite.addEventListener('click', () => void this.invite());
    e.start.addEventListener('click', () => this.send({ t: 'start' }));
    e.again.addEventListener('click', () => {
      this.send({ t: 'start' });
      ($('dlg-race') as HTMLDialogElement).close();
    });
    e.leave.addEventListener('click', () => this.leave());
    // Come back to a race after the phone was locked.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.code && this.ws?.readyState !== WebSocket.OPEN) {
        this.connect();
      }
    });
  }

  /** The room code in an invite link, /r/ABC123 (or the older /?race=ABC123), if any. */
  static codeFromUrl(): string | null {
    const fromPath = /^\/r\/([A-Za-z0-9]{6})\/?$/.exec(location.pathname)?.[1];
    const code = (fromPath ?? new URLSearchParams(location.search).get('race'))?.toUpperCase() ?? null;
    return code && ROOM_CODE.test(code) ? code : null;
  }

  /** Shows the Race tab. Joins `code` if given, or the last race. */
  show(code?: string | null) {
    this.active = true;
    if (code && code !== this.code) {
      this.disconnect();
      this.code = code;
      this.state = undefined;
    }
    this.code ??= store.get('race');
    if (this.code && this.name()) this.connect();
    this.draw();
  }

  hide() {
    this.active = false;
    void keepAwake(false);
    cancelAnimationFrame(this.timerFrame ?? 0);
    this.els.lobby.hidden = true;
    this.els.bar.hidden = true;
    this.els.boardWrap.hidden = false;
    this.host.tracker.hidden = false;
    this.builtShape = ''; // solo play rebuilds the board
  }

  get isActive() {
    return this.active;
  }

  // ------------------------------------------------------------ input

  onLetters(letters: string) {
    this.current = letters;
    this.drawBoard();
  }

  submit() {
    const s = this.state;
    if (!s || s.status !== 'playing' || this.sending) return;
    const row = s.mine.length;
    const guess = this.current;
    if ([...guess].length < s.wordLength) return this.reject(row, t('err.short'));
    const list = this.host.words(s.lang);
    if (list && !list.has(guess)) return this.reject(row, t('err.notWord'));
    if (s.hard) {
      const done = s.mine.filter((r): r is { guess: string; marks: Mark[] } => r.guess !== null);
      const v = checkHardMode(done, guess);
      if (v) return this.reject(row, this.host.describeViolation(v));
    }
    this.sending = true;
    this.send({ t: 'guess', word: guess });
  }

  private reject(row: number, message: string) {
    this.host.toast(message);
    this.host.board.shake(row);
  }

  // ------------------------------------------------------------ connection

  private name() {
    return store.get('name');
  }

  private async createOrJoin() {
    const name = this.els.name.value.trim();
    if (!name) {
      this.els.name.focus();
      this.host.toast(t('race.addName'));
      return;
    }
    store.set('name', name);
    if (this.code) {
      this.connect();
      return;
    }
    this.els.create.disabled = true;
    try {
      const res = await fetch('/api/v1/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.host.config()),
      });
      const body = (await res.json()) as { code?: string; message?: string };
      if (!res.ok || !body.code) throw new Error(t('race.couldNotStart'));
      this.code = body.code;
      track('race_created');
      store.set('race', this.code);
      this.connect();
    } catch (e) {
      this.host.toast(e instanceof TypeError ? t('race.offline') : t('race.couldNotStart'));
    } finally {
      this.els.create.disabled = false;
    }
  }

  private connect() {
    if (!this.code) return;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    clearTimeout(this.retryTimer);
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/api/v1/rooms/${this.code}/socket`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.retry = 0;
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('{"t":"ping"}');
      }, 30_000);
      const token = store.get(`race-token:${this.code}`) ?? undefined;
      this.send({ t: 'join', name: this.name() ?? 'Player', token });
    });
    ws.addEventListener('message', (ev) => {
      try {
        this.receive(JSON.parse(String(ev.data)) as ServerMessage);
      } catch {
        /* ignore malformed */
      }
    });
    ws.addEventListener('close', (ev) => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.sending = false;
      if (ev.code === 4000) {
        this.host.toast(t('race.otherTab'));
        return;
      }
      if (ev.code === 4001 || ev.code === 1008) return this.forget(t('race.ended'));
      if (!this.code) return;
      // Reconnect with backoff; the room remembers us by our token.
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
      this.draw();
    });
  }

  private disconnect() {
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = undefined;
    ws?.close(1000);
  }

  private send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.host.toast(t('race.reconnecting'));
  }

  private forget(message?: string) {
    if (this.code) store.set(`race-token:${this.code}`, null);
    store.set('race', null);
    this.disconnect();
    this.code = null;
    this.me = null;
    this.state = undefined;
    if (message) this.host.toast(message, 2500);
    if (RaceClient.codeFromUrl()) history.replaceState(null, '', '/');
    this.draw();
  }

  private leave() {
    this.forget();
  }

  private receive(msg: ServerMessage) {
    if (msg.t === 'welcome') {
      this.me = msg.you;
      store.set(`race-token:${this.code}`, msg.token);
      store.set('race', this.code);
      return;
    }
    if (msg.t === 'error') {
      this.sending = false;
      if (msg.code === 'room_full') return this.forget(t('race.full'));
      const row = this.state?.mine.length ?? 0;
      if (msg.code === 'hard_mode') this.reject(row, msg.message);
      else if (msg.code === 'not_in_list') this.reject(row, t('err.notWord'));
      else if (msg.code === 'wrong_length') this.reject(row, t('err.short'));
      else this.host.toast(ERRORS[msg.code] ? t(ERRORS[msg.code]) : msg.message);
      return;
    }
    if (msg.t !== 'state') return;
    const prev = this.state;
    const s = msg.state;
    this.skew = s.now - Date.now();
    this.state = s;
    this.host.loadWords(s.lang);
    // A new row of ours came back: clear the typed letters and flip it.
    const newRow = prev && prev.round === s.round && s.mine.length > prev.mine.length;
    if (newRow || !prev || prev.round !== s.round) {
      this.current = '';
      this.host.entry.clear();
    }
    this.sending = false;
    // Keep the screen on while the race runs (the 5-second row clock).
    void keepAwake(this.active && s.status === 'playing');
    this.draw();
    if (newRow && this.active) {
      const row = s.mine.length - 1;
      if (s.mine[row].guess === null) this.host.toast(t('race.lostRow'));
      void this.host.board.reveal(row);
    }
    if (s.status === 'finished' && s.result && this.shownResultRound !== s.round) {
      this.shownResultRound = s.round;
      if (this.active) window.setTimeout(() => this.showResult(), newRow ? 1600 : 300);
    }
  }

  // ------------------------------------------------------------ drawing

  private draw() {
    if (!this.active) return;
    const e = this.els;
    const s = this.state;
    const inRace = !!s && s.status !== 'lobby' && s.players.some((p) => p.id === this.me && p.inRound);
    e.lobby.hidden = inRace;
    e.bar.hidden = !inRace;
    e.boardWrap.hidden = !inRace;
    this.host.tracker.hidden = !inRace;
    if (!inRace) {
      this.host.entry.setEnabled(false);
      this.drawLobby();
    } else {
      this.drawRace();
    }
  }

  private describe(lang: string, hard: boolean) {
    const info = getLanguage(lang);
    return `${info?.nativeName ?? lang} · ${hard ? t('race.hard') : t('race.normal')}`;
  }

  private drawLobby() {
    const e = this.els;
    const s = this.state;
    const joined = !!s && !!this.me;
    e.intro.hidden = joined;
    e.room.hidden = !joined;
    if (!joined) {
      const cfg = this.host.config();
      const connecting = !!this.code && !!this.name();
      e.create.textContent = this.code ? t('race.join', { code: this.code }) : t('race.create');
      e.create.disabled = connecting && this.ws?.readyState === WebSocket.CONNECTING;
      e.config.textContent = this.code
        ? t('race.pickName')
        : t('race.configNote', { config: this.describe(cfg.lang, cfg.hard) });
      this.host.setSubtitle(this.code ? t('race.sub', { code: this.code }) : t('race.subIntro'));
      return;
    }
    e.code.textContent = s.code;
    e.roomConfig.textContent = this.describe(s.lang, s.hard);
    this.host.setSubtitle(`${t('race.sub', { code: s.code })} · ${this.describe(s.lang, s.hard)}`);
    e.players.replaceChildren(
      ...s.players.map((p) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = p.id === this.me ? t('race.you', { name: p.name }) : p.name;
        const tag = document.createElement('small');
        tag.textContent = t(
          !p.connected ? 'race.away' : p.id === s.hostId ? 'race.host' : s.status === 'playing' ? 'race.nextRound' : 'race.ready',
        );
        li.classList.toggle('away', !p.connected);
        li.append(name, tag);
        return li;
      }),
    );
    const host = s.hostId === this.me;
    const others = s.players.filter((p) => p.connected && p.id !== this.me).length;
    e.start.hidden = !host || s.status === 'playing';
    e.start.disabled = others < 1;
    e.wait.textContent =
      s.status === 'playing'
        ? t('race.underway')
        : host
          ? others < 1
            ? t('race.sendInvite')
            : t('race.everyoneIn')
          : t('race.waitHost');
  }

  private drawRace() {
    const s = this.state!;
    const playing = s.status === 'playing';
    const mine = s.players.find((p) => p.id === this.me);
    const done = !playing || !!mine?.solved || s.mine.length >= s.maxGuesses;
    const shape = `${s.maxGuesses}x${s.wordLength}`;
    if (this.builtShape !== shape) {
      this.host.board.build(s.maxGuesses, s.wordLength);
      this.host.entry.configure(s.wordLength);
      this.builtShape = shape;
    }
    this.host.entry.setEnabled(!done);
    this.drawBoard();
    const subtitle = playing
      ? done
        ? t('race.waitOthers')
        : `${t('race.sub', { code: s.code })} · ${this.describe(s.lang, s.hard)}`
      : t('race.over');
    this.host.setSubtitle(subtitle);
    this.drawOpponents();
    this.runTimer();
  }

  private drawBoard() {
    const s = this.state;
    if (!this.active || !s || s.status === 'lobby') return;
    const rows = s.mine.map((r) => ({
      guess: r.guess ?? ' '.repeat(s.wordLength),
      marks: r.marks,
    }));
    const playing = s.status === 'playing' && s.mine.length < s.maxGuesses;
    this.host.board.render(rows, this.current, playing);
    renderTracker(
      this.host.tracker,
      [...(getLanguage(s.lang)?.alphabet ?? 'abcdefghijklmnopqrstuvwxyz')],
      rows.filter((r) => r.guess.trim()),
    );
  }

  private drawOpponents() {
    const s = this.state!;
    const others = s.players.filter((p) => p.id !== this.me && p.inRound);
    this.els.opponents.replaceChildren(
      ...others.map((p) => {
        const card = document.createElement('div');
        card.className = 'opponent' + (p.connected ? '' : ' away') + (p.solved ? ' solved' : '');
        const name = document.createElement('span');
        name.className = 'opponent-name';
        name.textContent = p.name;
        const grid = document.createElement('div');
        grid.className = 'mini';
        grid.style.setProperty('--cols', String(s.wordLength));
        for (let r = 0; r < s.maxGuesses; r++) {
          const row = p.rows[r];
          for (let c = 0; c < s.wordLength; c++) {
            const cell = document.createElement('i');
            if (row) cell.className = row.lost ? 'lost' : (row.marks[c] as Mark);
            grid.append(cell);
          }
        }
        card.setAttribute(
          'aria-label',
          [
            t('race.rowsOf', { name: p.name, n: p.rows.length, max: s.maxGuesses }),
            p.solved ? t('race.solvedTag') : '',
            p.connected ? '' : t('race.away'),
          ]
            .filter(Boolean)
            .join(', '),
        );
        card.append(name, grid);
        return card;
      }),
    );
  }

  /** The bar that counts down your row once someone else has finished it. */
  private runTimer() {
    cancelAnimationFrame(this.timerFrame ?? 0);
    const s = this.state!;
    const deadline = s.players.find((p) => p.id === this.me)?.deadline;
    const e = this.els;
    if (!deadline || s.status !== 'playing') {
      e.timer.hidden = true;
      return;
    }
    e.timer.hidden = false;
    const total = ROW_SECONDS * 1000;
    let lastSecond = -1;
    const frame = () => {
      const left = Math.max(0, deadline - (Date.now() + this.skew));
      e.timerFill.style.setProperty('--left', String(Math.min(1, left / total)));
      const secs = Math.ceil(left / 1000);
      if (secs !== lastSecond) {
        lastSecond = secs;
        e.timerText.textContent = left > 0 ? t('race.timer', { n: secs }) : t('race.time');
        e.timer.classList.toggle('urgent', secs <= 2);
      }
      if (left > 0 && this.active) this.timerFrame = requestAnimationFrame(frame);
    };
    frame();
  }

  private showResult() {
    const s = this.state;
    if (!s?.result) return;
    const { result } = s;
    const winner = s.players.find((p) => p.id === result.winnerId);
    const word = [...result.answer].map((c) => toUpper(c)).join('');
    const solved = result.standings.find((x) => x.solved);
    const e = this.els;
    $('race-title').textContent = result.winnerId === this.me ? t('race.youWin') : t('race.over');
    const one = solved?.rows === 1;
    e.outcome.textContent = solved
      ? winner?.id === this.me
        ? t(one ? 'race.youFoundFirstOne' : 'race.youFoundFirst', { word, n: solved.rows })
        : t(one ? 'race.foundFirstOne' : 'race.foundFirst', { name: winner?.name ?? '?', word, n: solved.rows })
      : winner
        ? t('race.bestRowWins', { word })
        : t('race.draw', { word });
    e.standings.replaceChildren(
      ...result.standings.map((st) => {
        const li = document.createElement('li');
        li.classList.toggle('winner', st.id === result.winnerId);
        const name = document.createElement('strong');
        name.textContent = st.id === this.me ? t('race.you', { name: st.name }) : st.name;
        const detail = document.createElement('span');
        detail.textContent = st.solved
          ? t('race.foundIn', { n: st.rows })
          : st.bestRow
            ? t('race.bestRow', { n: st.bestRow, greens: st.greens, yellows: st.yellows })
            : t('race.noRows');
        const pts = document.createElement('b');
        pts.className = 'pts';
        pts.textContent = st.solved ? '✓' : t('race.pts', { n: st.points });
        li.append(name, detail, pts);
        return li;
      }),
    );
    $('race-scoring').hidden = !!solved;
    const host = s.hostId === this.me;
    e.again.hidden = !host;
    e.againNote.textContent = host ? t('race.againHost') : t('race.againGuest');
    this.host.openDialog('dlg-race');
  }

  private async invite() {
    if (!this.code) return;
    // The link preview (worker/og.ts) shows the code, in the sender's language.
    const url = `${location.origin}/r/${this.code}${uiLang() === 'en' ? '' : `?lang=${uiLang()}`}`;
    const text = t('race.inviteText', { code: this.code });
    try {
      if (navigator.share) {
        await navigator.share({ text, url });
        return;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      this.host.toast(t('race.inviteCopied'));
    } catch {
      this.host.toast(url, 4000);
    }
  }
}

