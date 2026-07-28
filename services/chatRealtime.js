// Realtime engine for the chat screens.
//
// WHY POLLING AND NOT THE WEBSOCKET
// ---------------------------------
// The server broadcasts on Odoo's bus: one notification type, 'chat369.event',
// carrying {event, conversation_id, ...} on a private per-user channel from
// /chat/bus_channel. Odoo 17+ delivers that over a websocket at /websocket
// (/longpolling/poll was removed in 16), and React Native does ship a global
// WebSocket — so this looks like it should be a websocket client.
//
// The blocker is auth. The websocket handshake is authenticated by the Odoo
// session cookie, and in React Native that cookie lives in the platform cookie
// store: axios sends it automatically via withCredentials, but JS cannot READ it,
// and RN's WebSocket does not share that store. Passing it explicitly needs a
// native cookie module (@react-native-cookies/cookies) and therefore a new dev
// build — which is exactly the dependency this project is trying to avoid until
// the calling phase.
//
// So this engine polls, which is what the reference OWL web client does anyway as
// its own safety net (a 6s /chat/conversations tick alongside the bus, because
// the bus is best-effort). Polling is strictly more reliable here, just less
// instant. The subscribe/dispatch shape below is deliberately the same one a bus
// client would use, so swapping in a websocket later means replacing the
// _tick loop and nothing else.
//
// Cadence is adaptive: the open thread is polled hard, the chat list gently, and
// everything stops when the app is backgrounded.
import { AppState } from 'react-native';
import * as chat from './chat';
import { createLogger } from '../api/logger';

const log = createLogger('ChatRT');

// The open conversation wants to feel live; the list can lag a little. Presence
// only counts as "online" for 45s after the last touch, so the heartbeat has to
// beat well inside that.
const THREAD_MS = 3000;
const LIST_MS = 6000;
const HEARTBEAT_MS = 25000;

// How often the open thread re-reads its newest window to pick up CHANGES to
// messages already on screen (link previews, reactions, edits, receipts). Every
// 4th tick ≈ 12s — frequent enough that a preview appears while you are still
// looking at the message, cheap enough not to matter.
const REFETCH_EVERY = 4;
const REFETCH_WINDOW = 30;

class ChatRealtime {
  constructor() {
    this.listeners = new Set();
    this.activeConversationId = null;
    this.lastMessageId = 0;      // cursor for the open thread
    this.timer = null;
    this.heartTimer = null;
    this.listTimer = null;
    this.running = false;
    this.appSub = null;
    this.inFlight = false;       // a slow poll must not stack up behind itself
    this.sinceRefetch = 0;       // ticks since the last update-catching refetch
  }

  // Screens subscribe with a callback and get an unsubscribe fn back. Events use
  // the SAME names the bus emits, so screen code is transport-agnostic:
  //   'message'   {conversationId, message}
  //   'update'    {conversationId, message}     (edit/delete/react/pin/poll vote)
  //   'conversations' {conversations, unreadTotal}
  //   'error'     {error}
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event, data) {
    this.listeners.forEach((fn) => {
      try { fn(event, data); } catch (e) { log.warn('listener threw', e?.message); }
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    log.info('realtime started');
    this._loopList();
    this._loopHeartbeat();
    // Stop burning battery and requests while backgrounded; resync on return.
    this.appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') { this._tickList(); this._tickThread(); }
    });
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer); clearTimeout(this.listTimer); clearInterval(this.heartTimer);
    this.timer = this.listTimer = this.heartTimer = null;
    if (this.appSub) { this.appSub.remove(); this.appSub = null; }
    log.info('realtime stopped');
  }

  // Called by the thread screen when it opens/closes a conversation. lastId seeds
  // the cursor so the first poll only asks for genuinely new messages.
  setActiveConversation(conversationId, lastId = 0) {
    this.activeConversationId = conversationId ? Number(conversationId) : null;
    this.lastMessageId = Number(lastId) || 0;
    clearTimeout(this.timer);
    if (this.activeConversationId) this._loopThread();
  }

  // Keep the cursor honest when the screen appends messages itself (its own sends,
  // or a scroll-back page that happens to include newer ids).
  noteMessageId(id) {
    if (Number(id) > this.lastMessageId) this.lastMessageId = Number(id);
  }

  // ── loops ──────────────────────────────────────────────────────────────────

  _loopThread() {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      await this._tickThread();
      if (this.running && this.activeConversationId) this._loopThread();
    }, THREAD_MS);
  }

  _loopList() {
    clearTimeout(this.listTimer);
    this.listTimer = setTimeout(async () => {
      await this._tickList();
      if (this.running) this._loopList();
    }, LIST_MS);
  }

  _loopHeartbeat() {
    clearInterval(this.heartTimer);
    this.heartTimer = setInterval(() => {
      chat.heartbeat().catch(() => {});   // presence is best-effort, never surface it
    }, HEARTBEAT_MS);
  }

  // ── ticks ──────────────────────────────────────────────────────────────────

  async _tickThread() {
    const convId = this.activeConversationId;
    if (!convId || this.inFlight) return;
    this.inFlight = true;
    try {
      // after_id returns the OLDEST page newer than the cursor, so loop until a
      // short page comes back — otherwise a burst of >50 messages arrives one
      // page per tick and the thread crawls.
      let guard = 0;
      for (;;) {
        const msgs = await chat.fetchMessages(convId, { afterId: this.lastMessageId, limit: 50 });
        if (!msgs.length) break;
        msgs.forEach((m) => {
          this.noteMessageId(m.id);
          this.emit('message', { conversationId: convId, message: m });
        });
        // Fewer than a full page means we've caught up.
        if (msgs.length < 50 || (guard += 1) > 5) break;
      }

      // after_id ONLY ever returns messages that did not exist before, so on its
      // own this loop can never see a CHANGE to a message already on screen:
      // a link preview finishing its background scrape, someone's reaction, an
      // edit, a delete, ticks turning blue. Those were simply never arriving.
      //
      // So every REFETCH_EVERY ticks, re-read the newest window and republish it
      // as updates. The screen replaces by id, so unchanged rows are a no-op.
      this.sinceRefetch += 1;
      if (this.sinceRefetch >= REFETCH_EVERY) {
        this.sinceRefetch = 0;
        const recent = await chat.fetchMessages(convId, { limit: REFETCH_WINDOW });
        recent.forEach((m) => this.emit('update', { conversationId: convId, message: m }));
      }
    } catch (e) {
      // A dead network mid-poll is normal and self-healing; don't spam the UI.
      log.warn('thread poll failed', e?.message);
    } finally {
      this.inFlight = false;
    }
  }

  async _tickList() {
    try {
      const { conversations, unreadTotal } = await chat.fetchConversations('all');
      this.emit('conversations', { conversations, unreadTotal });
    } catch (e) {
      log.warn('list poll failed', e?.message);
      this.emit('error', { error: e });
    }
  }

  // Force an immediate refresh — used after an action whose result the server does
  // NOT broadcast back to the actor (forward, delete-for-me, group edits, star,
  // archive, mute, pin). Those are invisible to any realtime transport by design.
  async refresh({ thread = true, list = true } = {}) {
    if (list) await this._tickList();
    if (thread) await this._tickThread();
  }
}

// One engine for the whole app — the chat list and the open thread share it.
const realtime = new ChatRealtime();
export default realtime;
