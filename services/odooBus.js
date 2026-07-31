// Odoo bus client — a real websocket subscription to the per-user channel.
//
// WHY THIS EXISTS
// ---------------
// `chatRealtime.js` polls, and its header explains why that was the only option:
// the /websocket handshake authenticates with the Odoo session cookie, axios sends
// that cookie automatically but JS cannot READ it, and RN's WebSocket does not
// share the platform cookie store. Reading it needs a native module.
//
// That module (@react-native-cookies/cookies) is now installed, so this file does
// what polling never could: deliver events the instant the server emits them.
//
// It is NOT a replacement for polling. Polling stays as the safety net, exactly as
// the OWL web client keeps its own 6s tick alongside the bus. What the bus adds is
// the class of events polling can never see at all:
//
//   call_ring / call_accept / call_reject / call_signal / call_end
//
// Those are pure bus payloads — they are never returned by /chat/messages, so no
// amount of polling surfaces them. Without this file a call cannot ring.
//
// WIRE PROTOCOL (verified against odoo/addons/bus in the installed 19.0 server)
// ----------------------------------------------------------------------------
//   → subscribe   {event_name:'subscribe', data:{channels:[ch], last:<id>}}
//   ← notifications  [{id, message:{type:'chat369.event', payload:{event, ...}}}]
// `last` is the highest id already seen; the server replays anything newer, so a
// reconnect after a dropped connection does not lose events — and does not repeat
// ones already handled. websocket_worker.js does exactly this.
import { AppState } from 'react-native';
import CookieManager from '@react-native-cookies/cookies';
import { getConnection } from '../api/session';
import { jsonRpc } from '../api/odooApi';
import { createLogger } from '../api/logger';

const log = createLogger('Bus');

// Reconnect backoff. Starts fast because the common case is a blip, and caps low
// enough that a phone coming back onto wifi reconnects while the user is still
// looking at the screen.
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];

// The bus is a nice-to-have layered over polling, so a handshake that hangs must
// not hold a socket open forever — drop it and let backoff retry.
const OPEN_TIMEOUT_MS = 15000;

class OdooBus {
  constructor() {
    this.listeners = new Set();
    this.ws = null;
    this.channel = null;
    this.wsUrl = null;           // supplied by /chat/bus_channel (gevent port)
    this.lastId = 0;
    this.running = false;
    this.attempt = 0;
    this.retryTimer = null;
    this.openTimer = null;
    this.connecting = false;
    this.appSub = null;
  }

  // Same subscribe/emit contract as chatRealtime, so a screen cannot tell which
  // transport delivered an event.
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event, data) {
    this.listeners.forEach((fn) => {
      try { fn(event, data); } catch (e) { log.warn('listener threw', e?.message); }
    });
  }

  isConnected() {
    return !!(this.ws && this.ws.readyState === 1);
  }

  start() {
    if (this.running) return;
    this.running = true;
    log.info('bus starting');
    this._connect();
    // A backgrounded socket is killed by the OS anyway; reconnect deliberately on
    // return rather than waiting for a silent-dead socket to time out.
    this.appSub = AppState.addEventListener('change', (state) => {
      if (!this.running) return;
      if (state === 'active' && !this.isConnected()) { this.attempt = 0; this._connect(); }
    });
  }

  stop() {
    this.running = false;
    clearTimeout(this.retryTimer); clearTimeout(this.openTimer);
    this.retryTimer = this.openTimer = null;
    if (this.appSub) { this.appSub.remove(); this.appSub = null; }
    this._closeSocket();
    // Channel is per-session; a new login must re-resolve it (and with it the
    // socket URL, which can differ per server).
    this.channel = null;
    this.wsUrl = null;
    this.lastId = 0;
    log.info('bus stopped');
  }

  _closeSocket() {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    try {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      ws.close();
    } catch (e) { /* already dead */ }
  }

  // ── connection ─────────────────────────────────────────────────────────────

  async _connect() {
    if (!this.running || this.connecting || this.isConnected()) return;
    this.connecting = true;
    try {
      const { serverUrl } = await getConnection();
      // Not set up yet. Retry rather than giving up: start() is called once per
      // session, so returning here permanently would leave the bus dead for the
      // whole session if it lost a race with the connection being persisted.
      if (!serverUrl) { this.connecting = false; this._scheduleRetry(); return; }

      if (!this.channel) {
        const res = await jsonRpc(serverUrl, '/chat/bus_channel', {}, 10000);
        this.channel = res?.channel || null;
        if (!this.channel) throw new Error('no bus channel returned');
        // The server tells us where the socket lives — see below for why.
        this.wsUrl = res?.ws_url || null;
      }

      // Odoo does NOT serve /websocket on the normal HTTP port. It runs on the
      // separate *evented* (gevent) process, on `gevent_port` — deriving the URL
      // from serverUrl gets a 404 forever, which is what silently stopped calls
      // from ringing. A browser is insulated from this by nginx proxying
      // /websocket across; the app has no proxy.
      //
      // The fallback keeps the old derivation only so a server that predates
      // ws_url still gets a connection attempt rather than nothing.
      const wsUrl = this.wsUrl
        || (serverUrl.replace(/^http/i, 'ws').replace(/\/+$/, '') + '/websocket');
      const headers = await this._authHeaders(serverUrl);

      // RN's WebSocket takes (url, protocols, options) and forwards options.headers
      // to the handshake. This is the whole reason the native cookie module exists:
      // without an explicit Cookie header the handshake is anonymous and Odoo
      // answers with a public session that can see nothing.
      const ws = new WebSocket(wsUrl, undefined, { headers });
      this.ws = ws;

      this.openTimer = setTimeout(() => {
        if (this.ws === ws && ws.readyState !== 1) {
          log.warn('handshake timed out');
          this._closeSocket();
          this._scheduleRetry();
        }
      }, OPEN_TIMEOUT_MS);

      ws.onopen = () => {
        clearTimeout(this.openTimer); this.openTimer = null;
        this.attempt = 0;
        log.info('bus connected');
        this._send({ event_name: 'subscribe', data: { channels: [this.channel], last: this.lastId } });
        this.emit('bus_state', { connected: true });
      };

      ws.onmessage = (ev) => this._onMessage(ev);

      // RN's WebSocket error event usually has no `message`, so the old
      // `e?.message` logged a bare "undefined" and told us nothing while the
      // real fault (a 404 from the wrong port) stayed invisible. Log the URL —
      // which is the thing most likely to be wrong — and whatever the event
      // actually carries.
      ws.onerror = (e) => log.warn('socket error', wsUrl, e?.message || e?.reason || e?.code || '(no detail)');

      ws.onclose = () => {
        if (this.ws !== ws) return;             // superseded by a newer socket
        this.ws = null;
        this.emit('bus_state', { connected: false });
        this._scheduleRetry();
      };
    } catch (e) {
      log.warn('connect failed', e?.message);
      this._scheduleRetry();
    } finally {
      this.connecting = false;
    }
  }

  // The session cookie, plus an Origin that matches the server. Odoo only checks
  // Origin when ODOO_BUS_PUBLIC_SAMESITE_WS is set, and a mismatch downgrades the
  // session to a public one rather than failing loudly — which would look like
  // "connected but no events ever arrive". Sending it costs nothing and removes
  // that failure mode entirely.
  async _authHeaders(serverUrl) {
    const headers = { Origin: serverUrl.replace(/\/+$/, '') };
    try {
      const jar = await CookieManager.get(serverUrl);
      const sid = jar?.session_id?.value;
      if (sid) headers.Cookie = `session_id=${sid}`;
      else log.warn('no session_id cookie — relying on the native cookie jar');
    } catch (e) {
      // Not fatal: on Android RN's WebSocket goes through OkHttp, which may apply
      // the shared cookie jar by itself. Let the handshake try.
      log.warn('cookie read failed', e?.message);
    }
    return headers;
  }

  _send(obj) {
    try { this.ws?.send(JSON.stringify(obj)); }
    catch (e) { log.warn('send failed', e?.message); }
  }

  _scheduleRetry() {
    if (!this.running || this.retryTimer) return;
    const wait = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._connect();
    }, wait);
  }

  // ── inbound ────────────────────────────────────────────────────────────────

  _onMessage(ev) {
    let notifications;
    try { notifications = JSON.parse(ev.data); } catch (e) { return; }
    if (!Array.isArray(notifications) || !notifications.length) return;

    // Advance the cursor even for types we ignore, so a reconnect does not replay
    // the whole backlog just because it contained something we did not handle.
    const last = notifications[notifications.length - 1];
    if (last && Number(last.id) > this.lastId) this.lastId = Number(last.id);

    notifications.forEach((n) => {
      const msg = n?.message;
      if (!msg || msg.type !== 'chat369.event') return;
      const payload = msg.payload || {};
      const event = payload.event;
      if (!event) return;
      // The server names the event inside the payload; re-emit under that name so
      // listeners match on 'message' / 'call_ring' / … exactly as the web client does.
      this.emit(event, payload);
    });
  }
}

// One socket for the whole app — chat screens and the call engine share it.
const bus = new OdooBus();
export default bus;
