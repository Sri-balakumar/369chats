// Realtime engine for the chat screens.
//
// TWO TRANSPORTS, ONE CONTRACT
// ----------------------------
// The server broadcasts on Odoo's bus: one notification type, 'chat369.event',
// carrying {event, conversation_id, ...} on a private per-user channel from
// /chat/bus_channel. `services/odooBus.js` now subscribes to that websocket for
// real — the native cookie module needed for its handshake arrived with the
// calling work.
//
// Polling did NOT go away, and should not. The reference OWL web client keeps its
// own 6s tick alongside the bus for the same reason: the bus is best-effort, and a
// dropped socket on a phone is routine. So:
//
//   bus     — instant, but only while connected
//   polling — a few seconds late, but always eventually right
//
// Both feed the SAME subscribe/emit contract below, so screen code cannot tell
// which one delivered an event and does not care. Duplicates are harmless: the
// screens replace messages by id.
//
// (Deliberately NOT done yet: slowing the poll while the bus is connected. It is
// the obvious battery win, but the bus is new and unverified on a device — keeping
// the poll at full rate means a bus bug shows up as "slightly late" rather than
// "silently broken". Revisit once calls are confirmed working on hardware.)
//
// Note the call events (call_ring / call_accept / call_signal / …) do NOT flow
// through here — `services/callEngine.js` subscribes to the bus directly, since
// they are not conversation-thread events.
//
// Cadence is adaptive: the open thread is polled hard, the chat list gently, and
// everything stops when the app is backgrounded.
import { AppState } from 'react-native';
import * as chat from './chat';
import bus from './odooBus';
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
    this.busSub = null;
    this.listNudge = null;       // debounce for bus-triggered list refreshes
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
    this._startBus();

    // Actually stop polling while backgrounded. This used only to resync on
    // return, leaving every timer running — which is why "online" was dishonest.
    //
    // Presence is `chat_last_seen` within a 45s window, refreshed by
    // _chat_touch_presence(), and that is called by the ORDINARY POLLING ROUTES
    // (/chat/conversations, /chat/messages, /chat/typing) as well as
    // /chat/heartbeat. So a backgrounded app polling every 6s kept reporting the
    // user as online while they were looking at something else entirely.
    // Stopping the heartbeat alone would not have fixed it.
    //
    // The bus stays connected on purpose: it costs nothing when idle, does not
    // touch presence, and is what lets a call ring while the app is backgrounded.
    this.appSub = AppState.addEventListener('change', (state) => {
      if (!this.running) return;
      if (state === 'active') {
        this._loopList();
        this._loopHeartbeat();
        if (this.activeConversationId) this._loopThread();
        this._tickList();
        this._tickThread();
      } else {
        this._stopPolling();
      }
    });
  }

  // Timers only — deliberately leaves `running` true and the bus up, so this is
  // a pause rather than a teardown.
  _stopPolling() {
    clearTimeout(this.timer); clearTimeout(this.listTimer); clearInterval(this.heartTimer);
    clearTimeout(this.listNudge);
    this.timer = this.listTimer = this.heartTimer = this.listNudge = null;
  }

  stop() {
    this.running = false;
    this._stopPolling();
    if (this.appSub) { this.appSub.remove(); this.appSub = null; }
    if (this.busSub) { this.busSub(); this.busSub = null; }
    bus.stop();
    log.info('realtime stopped');
  }

  // ── bus bridge ─────────────────────────────────────────────────────────────

  // Bridge the bus onto the existing subscribe/emit contract.
  //
  // This used to forward only 'message' and 'update' and drop everything else,
  // which quietly broke two features:
  //
  //   * READ RECEIPTS. 'read'/'delivered' are bus-only, so ticks never updated
  //     when they happened — they changed later, whenever the 12s refetch window
  //     came round, which reads as "ticks are unreliable".
  //   * TYPING. ChatThreadScreen has always listened for a 'typing' event and
  //     renders "…is typing", but the event never arrived, so the feature had
  //     never worked in the app at all.
  //
  // The web client handles all three (chat_app.js `_onBus`), so this was purely
  // an app-side gap. Call events stay ignored here on purpose — callEngine
  // subscribes to the bus directly.
  _startBus() {
    this.busSub = bus.subscribe((event, payload) => {
      const conversationId = Number(payload?.conversation_id) || 0;
      if (!conversationId) return;

      // Receipts carry no message body, only how far the other side has got.
      // Re-read the newest window rather than patching statuses by hand: the
      // refetch already re-emits those messages as 'update' and the screen
      // replaces by id, so ticks refresh with no new code path to get wrong.
      // Same approach the web client takes (syncMessages()).
      if (event === 'read' || event === 'delivered') {
        if (conversationId === this.activeConversationId) this._refetchRecent();
        else this._nudgeList();
        return;
      }

      // Passed straight through; the screen owns the "stopped typing" timeout.
      if (event === 'typing') {
        this.emit('typing', {
          conversationId,
          typing: !!payload.typing,
          name: payload.name || '',
          userId: payload.user_id,
        });
        return;
      }

      if (event !== 'message' && event !== 'update') return;
      const message = payload?.message;
      if (!message) return;

      if (event === 'message') {
        // Keep the poll cursor in step, or the next tick re-delivers this same
        // message and the thread shows it twice before dedupe settles.
        if (conversationId === this.activeConversationId) this.noteMessageId(message.id);
        this._nudgeList();
      }
      this.emit(event, { conversationId, message });
    });
    bus.start();
  }

  // Re-read the newest window and republish it as updates. Shared by the receipt
  // handler and the periodic refetch in _tickThread so there is one definition of
  // "catch changes to messages already on screen".
  async _refetchRecent() {
    const convId = this.activeConversationId;
    if (!convId) return;
    try {
      const recent = await chat.fetchMessages(convId, { limit: REFETCH_WINDOW });
      recent.forEach((m) => this.emit('update', { conversationId: convId, message: m }));
    } catch (e) {
      log.warn('receipt refetch failed', e?.message);
    }
  }

  // A new message changes the chat list too (preview, unread badge, order). Refresh
  // it, but debounced — a burst of messages should cost one /chat/conversations,
  // not one per message.
  _nudgeList() {
    if (this.listNudge) return;
    this.listNudge = setTimeout(() => {
      this.listNudge = null;
      if (this.running) this._tickList();
    }, 400);
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
        await this._refetchRecent();
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
