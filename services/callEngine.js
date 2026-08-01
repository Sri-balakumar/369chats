// 1:1 WebRTC calling for the app — a port of the web client's implementation in
// odoo_modules/chats_369/static/src/chat_app/chat_app.js (the "In-app calls"
// section). The web client is the design source of truth and is the known-good
// peer to test against, so the ORDERING below is deliberately identical to it.
//
// Four details are load-bearing. Each one produces a call that "works sometimes",
// which is the worst possible failure mode, so none of them are optional:
//
//  1. THE CALLEE NEVER CREATES THE OFFER. The caller creates it only after the
//     bus delivers `call_accept`. Offering earlier races the callee's peer
//     connection into existence and the answer lands on nothing.
//
//  2. ICE CANDIDATES ARRIVE BEFORE THE DESCRIPTION THEY BELONG TO. Trickle ICE
//     means the peer starts sending candidates the moment it has any, which is
//     routinely before its offer/answer has reached us. addIceCandidate() throws
//     if there is no remote description yet, so early candidates are buffered and
//     flushed afterwards.
//
//  3. TEARDOWN MUST NULL THE HANDLERS BEFORE close(). Otherwise onconnectionstate
//     change fires during shutdown and re-enters endCall().
//
//  4. ICE CONFIG IS CACHED PER CONVERSATION, never globally. TURN credentials are
//     released per-chat by the server, so a shared cache hands one chat another
//     chat's entitlement.
//
// Media path only — the signalling wrappers live in services/chat.js and the
// events arrive on services/odooBus.js. Without the bus connected a call cannot
// ring at all; polling never sees these events.
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
} from 'react-native-webrtc';
import * as chat from './chat';
import bus from './odooBus';
import { createLogger } from '../api/logger';

const log = createLogger('Call');

const FALLBACK_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

// Matches the web client's constraints so both ends negotiate the same profile.
const VIDEO_CONSTRAINTS = { width: 1280, height: 720 };

// Give up on a call that never reaches 'connected'. Without this a failed
// negotiation leaves `this.call` set forever: the engine then reports itself busy,
// auto-rejects every incoming call, and refuses to place new ones — so ONE failed
// call bricks calling until the app is restarted. Long enough to cover a slow
// ICE gather on a bad network, short enough that a person is still watching.
const CONNECT_TIMEOUT_MS = 45000;

class CallEngine {
  constructor() {
    this.listeners = new Set();
    this.call = null;            // null when idle — the single source of truth
    this.starting = false;       // synchronous re-entry guard; see startCall()
    this.connectTimer = null;    // kills a call that never reaches 'connected'
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.pendingIce = null;
    this.iceCache = null;
    this.iceCacheFor = null;
    this.timer = null;
    this.busSub = null;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  // Safe to call repeatedly; App mounts this once at login.
  //
  // bus.start() is called here as well as by chatRealtime because a call must be
  // answerable from any screen. chatRealtime is only started by ChatListScreen, so
  // relying on it alone would mean no ringing until the chat list had mounted.
  // Both calls are idempotent.
  start() {
    bus.start();
    if (this.busSub) return;
    this.busSub = bus.subscribe((event, payload) => {
      switch (event) {
        case 'call_ring':   return this._onRing(payload);
        case 'call_accept': return this._onAccept(payload);
        case 'call_signal': return this._onSignal(payload);
        case 'call_reject': return this._onReject(payload);
        case 'call_end':    return this._onEnd(payload);
        default:            return undefined;
      }
    });
  }

  stop() {
    if (this.busSub) { this.busSub(); this.busSub = null; }
    this._teardown();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Screens re-render off a snapshot rather than the live object, so React sees a
  // new identity every time and never misses an in-place mutation.
  _publish() {
    const snap = this.call
      ? { ...this.call, localStream: this.localStream, remoteStream: this.remoteStream }
      : null;
    this.listeners.forEach((fn) => {
      try { fn(snap); } catch (e) { log.warn('listener threw', e?.message); }
    });
  }

  getState() {
    return this.call
      ? { ...this.call, localStream: this.localStream, remoteStream: this.remoteStream }
      : null;
  }

  isBusy() { return !!this.call; }

  // ── media + peer connection ────────────────────────────────────────────────

  async _getMedia(video) {
    return mediaDevices.getUserMedia({
      audio: true,
      video: video ? VIDEO_CONSTRAINTS : false,
    });
  }

  async _iceConfig(convId) {
    const key = Number(convId) || 0;
    if (this.iceCache && this.iceCacheFor === key) return this.iceCache;
    try {
      const ice = await chat.fetchIceServers(key);
      this.iceCache = ice.length ? ice : FALLBACK_ICE;
    } catch (e) {
      // STUN-only still connects on the same network, which is better than
      // refusing to place the call at all.
      log.warn('ice fetch failed, falling back to public STUN', e?.message);
      this.iceCache = FALLBACK_ICE;
    }
    this.iceCacheFor = key;
    return this.iceCache;
  }

  _createPc(ice) {
    const pc = new RTCPeerConnection({ iceServers: ice });

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream));
    }

    // These are assigned as on* properties rather than addEventListener, and that
    // is deliberate: _teardown() nulls them, and nulling only works for the
    // property form. Registering with addEventListener and then nulling would
    // leave the listeners live through close() — see note 3 at the top.
    //
    // react-native-webrtc always populates event.streams for a negotiated m-line,
    // so take the stream wholesale rather than assembling one track at a time.
    pc.ontrack = (ev) => {
      const stream = ev.streams && ev.streams[0];
      if (!stream) return;
      this.remoteStream = stream;
      this._publish();
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) this._signal('ice', ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate);
    };

    pc.onconnectionstatechange = () => {
      const c = this.call;
      if (!c || this.pc !== pc) return;
      const st = pc.connectionState;
      if (st === 'connected' && c.status !== 'connected') {
        c.status = 'connected';
        clearTimeout(this.connectTimer); this.connectTimer = null;
        this._startTimer();
        this._publish();
      }
      // Only treat a drop as a hangup once we were actually up; the same states
      // occur transiently while negotiating.
      if (['failed', 'closed', 'disconnected'].includes(st) && c.status === 'connected') {
        this.hangup();
      }
    };

    this.pendingIce = [];
    return pc;
  }

  async _signal(kind, data) {
    const c = this.call;
    if (!c || !c.id) return;
    try { await chat.sendCallSignal(c.convId, c.id, kind, data); }
    catch (e) { log.warn('signal failed', kind, e?.message); }
  }

  async _flushIce() {
    if (!this.pendingIce || !this.pendingIce.length) return;
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const cand of queued) {
      try { await this.pc.addIceCandidate(new RTCIceCandidate(cand)); }
      catch (e) { log.warn('addIceCandidate failed', e?.message); }
    }
  }

  // ── outgoing ───────────────────────────────────────────────────────────────

  // `conv` needs { id, title, avatarUrl, isGroup }. Returns an error string on
  // refusal, or null when the call is ringing.
  async startCall(conv, video = false) {
    // `this.call` alone is NOT a re-entry guard: it is not assigned until after
    // the two awaits below, leaving a window of hundreds of milliseconds in which
    // further taps sail straight past it. That window was real — a single press
    // produced FIVE /chat/call/start requests in 50ms, and the damage is worse
    // than duplicate work:
    //
    //   * each start mints its own call_id and rings the callee separately;
    //   * the callee answers one and busy-rejects the rest;
    //   * all five races share one `this.call`, so the id left in it is whichever
    //     response happened to land last — usually NOT the one that was accepted;
    //   * `_onAccept` then sees p.call_id !== c.id and returns, so the offer is
    //     never created and the call dies silently in "Ringing…".
    //
    // Hence a synchronous flag, set before anything can yield.
    if (this.call || this.starting) return 'Already in a call.';
    if (!conv || conv.isGroup) return 'Calls are 1:1 only.';
    this.starting = true;

    try {
      try { this.localStream = await this._getMedia(video); }
      catch (e) {
        log.warn('getUserMedia denied', e?.message);
        return video ? 'Camera and microphone permission is needed.' : 'Microphone permission is needed.';
      }

      return await this._startCallInner(conv, video);
    } finally {
      this.starting = false;
    }
  }

  async _startCallInner(conv, video) {
    const ice = await this._iceConfig(conv.id);
    this.call = {
      id: null, convId: conv.id, video: !!video, status: 'outgoing', caller: true,
      name: conv.title || '', avatar: conv.avatarUrl || null,
      muted: false, camOff: false, secs: 0,
    };
    this.pc = this._createPc(ice);
    this._armConnectTimeout();
    this._publish();

    try {
      const { callId, ice: freshIce } = await chat.startCall(conv.id, video);
      if (!this.call) return null;                  // hung up while the call was in flight
      this.call.id = callId;
      if (freshIce && freshIce.length) { this.iceCache = freshIce; this.iceCacheFor = conv.id; }
      this._publish();
      return null;
    } catch (e) {
      const msg = e?.isChatError ? e.message : 'Could not start the call.';
      this._teardown();
      return msg;
    }
  }

  // ── incoming ───────────────────────────────────────────────────────────────

  _onRing(p) {
    // Busy-reject, exactly as the web client does: one call at a time, and the
    // caller gets a decline rather than silence.
    if (this.call) {
      chat.rejectCall(p.conversation_id, p.call_id).catch(() => {});
      return;
    }
    this.call = {
      id: p.call_id, convId: p.conversation_id, video: !!p.video, status: 'incoming', caller: false,
      name: p.name || '', avatar: p.avatar || null, fromId: p.from_id,
      muted: false, camOff: false, secs: 0,
    };
    this._publish();
  }

  async accept() {
    const c = this.call;
    if (!c || c.status !== 'incoming') return null;

    try { this.localStream = await this._getMedia(c.video); }
    catch (e) {
      log.warn('getUserMedia denied on accept', e?.message);
      this.reject();
      return 'Microphone permission is needed.';
    }

    const ice = await this._iceConfig(c.convId);
    // The caller can give up while the OS permission sheet is still open. Release
    // the mic/camera explicitly — _teardown already ran and cannot see this stream.
    if (!this.call) {
      try { this.localStream?.getTracks().forEach((t) => t.stop()); } catch (e) {}
      this.localStream = null;
      return null;
    }
    this.pc = this._createPc(ice);
    this._armConnectTimeout();
    c.status = 'connecting';
    this._publish();

    // Tells the caller to produce the offer. Nothing else happens until it lands.
    try { await chat.acceptCall(c.convId, c.id); }
    catch (e) { log.warn('accept failed', e?.message); }
    return null;
  }

  async reject() {
    const c = this.call;
    if (!c) return;
    try { await chat.rejectCall(c.convId, c.id); } catch (e) { /* best effort */ }
    this._teardown();
  }

  // ── signalling ─────────────────────────────────────────────────────────────

  async _onAccept(p) {
    const c = this.call;
    if (!c || !c.caller || !this.pc) return;
    if (p.call_id && c.id && p.call_id !== c.id) return;
    c.status = 'connecting';
    this._publish();
    try {
      const offer = await this.pc.createOffer({});
      await this.pc.setLocalDescription(offer);
      this._signal('offer', offer);
    } catch (e) {
      log.warn('createOffer failed', e?.message);
      this.hangup();
    }
  }

  async _onSignal(p) {
    const c = this.call;
    if (!c || !this.pc) return;
    if (p.call_id && c.id && p.call_id !== c.id) return;

    let data;
    try { data = JSON.parse(p.data); } catch (e) { return; }

    try {
      if (p.kind === 'offer') {
        await this.pc.setRemoteDescription(new RTCSessionDescription(data));
        await this._flushIce();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this._signal('answer', answer);
      } else if (p.kind === 'answer') {
        await this.pc.setRemoteDescription(new RTCSessionDescription(data));
        await this._flushIce();
      } else if (p.kind === 'ice') {
        // See note 2 at the top: a candidate can legitimately beat its description.
        if (this.pc.remoteDescription && this.pc.remoteDescription.type) {
          await this.pc.addIceCandidate(new RTCIceCandidate(data));
        } else {
          (this.pendingIce = this.pendingIce || []).push(data);
        }
      }
    } catch (e) {
      log.warn('signal handling failed', p.kind, e?.message);
    }
  }

  _onReject(p) {
    const c = this.call;
    if (!c || !c.caller) return;
    if (p.call_id && c.id && p.call_id !== c.id) return;
    this.hangup({ declined: true });
  }

  _onEnd(p) {
    const c = this.call;
    if (!c) return;
    if (p.call_id && c.id && p.call_id !== c.id) return;
    // The peer already logged it; just clean up locally.
    this._teardown();
  }

  // ── ending ─────────────────────────────────────────────────────────────────

  // Hanging up is the one place both sides call the same route, so `log` is gated
  // on being the caller — see the note on chat.endCall().
  async hangup({ declined = false } = {}) {
    const c = this.call;
    if (!c) return;
    const { convId, id, caller, video } = c;
    const connected = c.status === 'connected';
    const secs = c.secs || 0;

    this._teardown();

    try {
      await chat.endCall(convId, id, {
        duration: secs,
        missed: !connected,
        video,
        log: caller,
      });
    } catch (e) { log.warn('end failed', e?.message); }

    if (declined) log.info('call declined by peer');
  }

  // Fires only if the peer connection never reaches 'connected'; cancelled the
  // moment it does, and by _teardown on any normal ending.
  _armConnectTimeout() {
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (!this.call || this.call.status === 'connected') return;
      log.warn('call never connected within', CONNECT_TIMEOUT_MS, 'ms — giving up');
      this.hangup();
    }, CONNECT_TIMEOUT_MS);
  }

  _teardown() {
    clearInterval(this.timer); this.timer = null;
    clearTimeout(this.connectTimer); this.connectTimer = null;
    this.starting = false;

    // Handlers first — see note 3 at the top.
    try {
      if (this.pc) {
        this.pc.ontrack = null;
        this.pc.onicecandidate = null;
        this.pc.onconnectionstatechange = null;
        this.pc.close();
      }
    } catch (e) { /* already closed */ }
    this.pc = null;

    try { this.localStream?.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { this.remoteStream?.getTracks().forEach((t) => t.stop()); } catch (e) {}
    this.localStream = null;
    this.remoteStream = null;
    this.pendingIce = null;
    this.call = null;
    this._publish();
  }

  // ── in-call controls ───────────────────────────────────────────────────────

  toggleMute() {
    const c = this.call;
    if (!c || !this.localStream) return;
    c.muted = !c.muted;
    this.localStream.getAudioTracks().forEach((t) => { t.enabled = !c.muted; });
    this._publish();
  }

  toggleCam() {
    const c = this.call;
    if (!c || !this.localStream) return;
    c.camOff = !c.camOff;
    this.localStream.getVideoTracks().forEach((t) => { t.enabled = !c.camOff; });
    this._publish();
  }

  // Front/back flip. _switchCamera is react-native-webrtc's own extension on the
  // track — there is no standard API for this.
  switchCamera() {
    try { this.localStream?.getVideoTracks().forEach((t) => t._switchCamera && t._switchCamera()); }
    catch (e) { log.warn('switchCamera failed', e?.message); }
  }

  _startTimer() {
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!this.call) return;
      this.call.secs += 1;
      this._publish();
    }, 1000);
  }
}

const callEngine = new CallEngine();
export default callEngine;
