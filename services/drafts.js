// Per-chat unsent text, kept on the device.
//
// The web client does the same thing in localStorage under `o369_drafts`, and
// shows a "Draft:" preview on the conversation row — leaving a half-typed
// message and coming back to nothing is the kind of small loss people notice
// immediately.
//
// Held in memory and mirrored to AsyncStorage: the chat list re-renders on every
// realtime poll, so reading a draft has to be synchronous.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../api/logger';

const log = createLogger('Drafts');
const KEY = 'chat_drafts';

let cache = {};
let loaded = false;
let saveTimer = null;

export async function loadDrafts() {
  if (loaded) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? JSON.parse(raw) || {} : {};
  } catch (e) {
    log.warn('load failed', e?.message);
    cache = {};
  }
  loaded = true;
  return cache;
}

export function draftFor(conversationId) {
  return cache[String(conversationId)] || '';
}

// Debounced: this fires on every keystroke.
export function setDraft(conversationId, text) {
  const id = String(conversationId);
  const v = (text || '').trim();
  if (v) cache[id] = text; else delete cache[id];

  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch((e) => log.warn('save failed', e?.message));
  }, 400);
}

export function clearDraft(conversationId) { setDraft(conversationId, ''); }
