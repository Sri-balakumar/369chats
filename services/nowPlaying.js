// What voice note is playing right now, app-wide.
//
// WhatsApp keeps a voice note playing when you back out of the thread and shows a
// small bar on the chat list so you can pause it or jump back. The player itself
// lives inside one AudioBubble, so the bar needs a way to reach it without the
// two screens knowing about each other — hence this tiny store rather than
// threading callbacks through App.js.
//
// Deliberately not React state: AudioBubble publishes from an effect while the
// chat list may not even be mounted, so a plain subscribable module is simpler
// and cannot cause a cross-tree update warning.

let current = null;          // { id, conversationId, author, onPause }
const listeners = new Set();

function emit() { listeners.forEach((fn) => fn(current)); }

export function setNowPlaying(entry) {
  // Only one clip plays at a time; a new one replaces whatever was there.
  if (current && current.id === entry.id) { current = entry; return; }
  current = entry;
  emit();
}

// Guarded by id so a bubble unmounting after another has started playing cannot
// clear the newer one.
export function clearNowPlaying(id) {
  if (!current) return;
  if (id != null && current.id !== id) return;
  current = null;
  emit();
}

export function getNowPlaying() { return current; }

export function subscribeNowPlaying(fn) {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}
