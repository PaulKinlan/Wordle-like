// A race room: one Durable Object per room code. Players connect over a
// WebSocket (hibernation API, so an idle room costs nothing) and the room
// keeps the answer, every guess and the row clocks. The rules are in race.ts.
import { DurableObject } from 'cloudflare:workers';
import { normalizeWord } from '../shared/game';
import { getLanguage } from '../shared/languages';
import { MAX_SOCKETS, type ClientMessage, type ServerMessage } from '../shared/race';
import { D1AnswerStore } from './answers';
import { Race, RaceError, type RaceData } from './race';
import { parseRaceAlert, sendRaceJoined } from './push';
import { recordEvent } from './telemetry';
import { getWords } from './words';
import type { Env } from './index';

/** Rooms are deleted after a day without activity. */
const IDLE_MS = 24 * 60 * 60 * 1000;

interface Attachment {
  playerId?: string;
}

export class Room extends DurableObject<Env> {
  private race?: Race;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  private async load(): Promise<Race | undefined> {
    if (this.race) return this.race;
    const data = await this.ctx.storage.get<RaceData>('race');
    if (!data) return undefined;
    const words = getWords(data.lang)!;
    this.race = new Race(data, (w) => words.guessable.has(w));
    return this.race;
  }

  private async save() {
    if (!this.race) return;
    await this.ctx.storage.put('race', this.race.data);
    const next = this.race.nextDeadline();
    const idle = this.race.data.lastActivity + IDLE_MS;
    await this.ctx.storage.setAlarm(next !== undefined ? Math.min(next, idle) : idle);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/init' && request.method === 'POST') {
      if (await this.load()) return new Response('exists', { status: 409 });
      const { code, lang, hard } = (await request.json()) as { code: string; lang: string; hard: boolean };
      const info = getLanguage(lang)!;
      const data = Race.create(
        { code, lang, hard, wordLength: info.wordLength, maxGuesses: info.maxGuesses },
        Date.now(),
      );
      const words = getWords(lang)!;
      this.race = new Race(data, (w) => words.guessable.has(w));
      await this.save();
      return new Response('ok');
    }
    if (url.pathname === '/socket') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      if (!(await this.load())) return new Response('No such race', { status: 404 });
      // Sockets that connect and never join would otherwise pile up without limit.
      if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response('Too many connections', { status: 429 });
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({} satisfies Attachment);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Not found', { status: 404 });
  }

  private connectedIds(): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.playerId) ids.add(a.playerId);
    }
    return ids;
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // closed: ignore
    }
  }

  /** Sends every player their own view of the room. */
  private broadcast() {
    const race = this.race;
    if (!race) return;
    const ids = this.connectedIds();
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      this.send(ws, { t: 'state', state: race.view(a?.playerId, now, (id) => ids.has(id)) });
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const race = await this.load();
    if (!race || typeof raw !== 'string' || raw.length > 2000) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const now = Date.now();
    const before = race.data.status;
    const attachment = (ws.deserializeAttachment() as Attachment | null) ?? {};
    try {
      if (msg.t === 'ping') return this.send(ws, { t: 'pong' });
      if (msg.t === 'join') {
        const known = new Set(race.data.players.map((x) => x.id));
        const here = this.connectedIds();
        const p = race.join(msg.name, msg.token, now, (pid) => here.has(pid));
        if (!known.has(p.id)) this.alertJoined(race, p.id, p.name);
        // One socket per player: close an older tab of the same player.
        for (const other of this.ctx.getWebSockets()) {
          const a = other.deserializeAttachment() as Attachment | null;
          if (other !== ws && a?.playerId === p.id) other.close(4000, 'Opened in another tab');
        }
        ws.serializeAttachment({ playerId: p.id } satisfies Attachment);
        this.send(ws, { t: 'welcome', you: p.id, token: p.token });
      } else {
        const id = attachment.playerId;
        if (!id) throw new RaceError('not_joined', 'Join first');
        // Whoever sent this is here, even if their socket is already closing behind the message.
        const ids = this.connectedIds().add(id);
        const connected = (pid: string) => ids.has(pid);
        if (msg.t === 'start') {
          // Checked first, so only a real start reads the database.
          race.canStart(id, connected);
          const answer = await this.pickAnswer(race);
          race.start(id, answer, Date.now(), connected);
          this.usage('started');
        } else if (msg.t === 'cancel') {
          race.canCancel(id, connected);
          return await this.destroy('Race cancelled');
        } else if (msg.t === 'leave') {
          const removed = race.leave(id, now);
          ws.serializeAttachment({} satisfies Attachment);
          ws.close(1000, 'Left');
          // An empty room has no use: don't keep it for a day.
          if (removed && race.data.players.length === 0) return await this.destroy('Race ended');
        } else if (msg.t === 'guess') {
          race.guess(id, msg.word, now);
        } else if (msg.t === 'notify') {
          const alert = parseRaceAlert(msg.sub, msg.ui);
          const me = race.data.players.find((p) => p.id === id);
          if (!alert || !me) throw new RaceError('bad_request', 'Could not turn on alerts');
          me.alert = alert;
        } else {
          return;
        }
      }
    } catch (e) {
      if (e instanceof RaceError) return this.send(ws, { t: 'error', code: e.code, message: e.message });
      console.error(e);
      return this.send(ws, { t: 'error', code: 'server_error', message: 'Something went wrong' });
    }
    if (before === 'playing' && race.data.status === 'finished') this.usage('finished');
    await this.save();
    this.broadcast();
  }

  /** Closes the room for everyone and forgets it. */
  private async destroy(reason: string) {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(4001, reason);
      } catch {
        // already closed
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.race = undefined;
  }

  /** Pushes "Sam joined your race" to everyone else who asked for it. */
  private alertJoined(race: Race, newId: string, name: string) {
    for (const p of race.data.players) {
      if (p.id === newId || !p.alert) continue;
      const alert = p.alert;
      this.ctx.waitUntil(
        sendRaceJoined(this.env, alert, name, race.data.code).then(async (ok) => {
          if (ok || p.alert !== alert) return;
          delete p.alert; // the subscription has gone
          await this.save();
        }),
      );
    }
  }

  /** For the dashboard: races started and finished. */
  private usage(name: 'started' | 'finished') {
    const { lang, hard, round, players } = this.race!.data;
    const value = players.filter((p) => p.inRound).length; // players in this round
    this.ctx.waitUntil(recordEvent(this.env.DB, null, { kind: 'race', name, value, message: lang, detail: { hard, round } }));
  }

  /** A random answer from the private order, like unlimited play. */
  private async pickAnswer(race: Race): Promise<string> {
    const { lang, hard } = race.data;
    const list = getWords(lang)!;
    const set = hard ? `${lang}:rare` : lang;
    const store = new D1AnswerStore(this.env.DB);
    const count = await store.count(set, hard ? list.rare : list.candidates);
    const index = crypto.getRandomValues(new Uint32Array(1))[0] % count;
    const answer = await store.at(set, index);
    // Sanity check: the answer must be a word the players can type.
    if (!list.guessable.has(normalizeWord(answer, lang))) throw new Error('Answer not guessable');
    return answer;
  }

  async webSocketClose(ws: WebSocket) {
    ws.close();
    if (await this.load()) this.broadcast(); // shows the player as away
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  async alarm() {
    const race = await this.load();
    if (!race) return;
    const now = Date.now();
    if (now >= race.data.lastActivity + IDLE_MS) return this.destroy('Race expired');
    const before = race.data.status;
    if (race.tick(now)) this.broadcast();
    if (before === 'playing' && race.data.status === 'finished') this.usage('finished');
    await this.save();
  }
}
