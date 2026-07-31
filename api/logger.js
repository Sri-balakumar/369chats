// Tagged logger for debugging the login / Odoo / chat flows.
//
// WHY THIS IS SWITCHABLE AT RUNTIME
// ---------------------------------
// This used to be `const ENABLED = __DEV__`, which meant a RELEASE build was
// totally silent. That is the right default — production should not log — but it
// also meant the only way to diagnose anything on a real device was a USB cable
// and `adb logcat`. The startup crash on 2026-07-31 was invisible for exactly
// that reason.
//
// So logging is now a runtime flag, off by default in release, and everything it
// records also goes into an in-memory ring buffer that a screen can display and
// share. That makes a device diagnosable with no PC, no cable and no rebuild.
//
// SECRETS: redact() is applied AUTOMATICALLY to anything buffered. It used to be
// opt-in per call site (`log.info('x', log.redact(params))`), which is fine when
// the output dies in a dev console but not when the user can mail the buffer to
// someone. Call sites may still call redact() themselves; doing it twice is
// harmless.
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEV = typeof __DEV__ === 'undefined' ? true : __DEV__;
const STORAGE_KEY = 'debug.logging.enabled';

// Enough to cover an app launch plus a call attempt, small enough that holding it
// all in memory never matters.
const RING_MAX = 500;

let enabled = DEV;
const ring = [];
const watchers = new Set();

// Keys whose values must never be printed in full.
const SECRET_KEYS = ['password', 'pw', 'pass', 'session_id', 'token', 'cookie', 'credential', 'turn_cred'];

// Shallow-clone an object, masking secret fields so passwords never hit the log.
export function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    if (SECRET_KEYS.includes(k)) {
      const v = obj[k];
      out[k] = v ? '***' + String(v).length + 'chars***' : v;
    } else {
      out[k] = obj[k];
    }
  }
  return out;
}

// Render one argument for the buffer. Depth-1 redaction matches redact() itself;
// anything deeper is stringified by JSON and accepted as-is, so do not log a
// nested credential and expect it masked.
function format(a) {
  if (a instanceof Error) return a.message;
  if (a === null || a === undefined) return String(a);
  if (typeof a !== 'object') return String(a);
  try { return JSON.stringify(redact(a)); } catch (e) { return '[unserialisable]'; }
}

function push(level, tag, args) {
  ring.push({
    t: new Date().toISOString().slice(11, 23),   // HH:MM:SS.mmm — date is noise on one session
    level,
    tag,
    msg: args.map(format).join(' '),
  });
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  watchers.forEach((fn) => { try { fn(); } catch (e) { /* a viewer must never break logging */ } });
}

// ── control ──────────────────────────────────────────────────────────────────

export function isLoggingEnabled() { return enabled; }

export async function setLoggingEnabled(on) {
  enabled = !!on;
  try { await AsyncStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (e) { /* best effort */ }
  return enabled;
}

// Call once at startup. Restores the persisted choice so a switched-on device
// keeps logging across relaunches — which is the point, since the interesting
// failures happen during launch.
export async function loadLoggingPref() {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    if (v === '1') enabled = true;
    else if (v === '0') enabled = false;
  } catch (e) { /* keep the default */ }
  return enabled;
}

export function getLogBuffer() { return ring.slice(); }
export function clearLogBuffer() { ring.length = 0; watchers.forEach((fn) => { try { fn(); } catch (e) {} }); }
export function onLogChange(fn) { watchers.add(fn); return () => watchers.delete(fn); }

// Plain text for sharing. Oldest first, so it reads like a transcript.
export function formatLogBuffer() {
  if (!ring.length) return 'No log entries captured.';
  return ring.map((e) => `${e.t} ${e.level.toUpperCase().padEnd(5)} [${e.tag}] ${e.msg}`).join('\n');
}

// ── the logger itself ────────────────────────────────────────────────────────

export function createLogger(tag) {
  const prefix = `[${tag}]`;
  const emit = (level, fn, args) => {
    if (!enabled) return;
    push(level, tag, args);
    // Console output only in dev. In release the buffer IS the output — writing to
    // console there costs work for something nobody can read without a cable.
    if (DEV) fn(prefix, ...args);
  };
  return {
    info: (...a) => emit('info', console.log, a),
    warn: (...a) => emit('warn', console.warn, a),
    error: (...a) => emit('error', console.error, a),
    redact,
  };
}
