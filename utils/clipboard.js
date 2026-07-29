// Copy text to the system clipboard.
//
// Deliberately not the share sheet: "Copy" should copy, the way WhatsApp does.
// Sharing a message to pick "Copy" out of a sheet is two extra taps and lands
// the text in whatever app the user mis-taps.
//
// Two sources, in order:
//   1. expo-clipboard — the supported package, but a NATIVE module, so it only
//      exists once a dev-client rebuild includes it. Tried first so this file
//      needs no edit when that lands.
//   2. React Native's own Clipboard — deprecated and slated for removal, but it
//      is still in RN 0.81 core and its native side is already in the build, so
//      it works today with nothing installed.
import { createLogger } from '../api/logger';

const log = createLogger('Clipboard');

export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return false;

  try {
    // eslint-disable-next-line global-require
    const expo = require('expo-clipboard');
    if (expo?.setStringAsync) { await expo.setStringAsync(value); return true; }
  } catch (_) { /* not installed — fall through */ }

  try {
    // eslint-disable-next-line global-require
    const { Clipboard } = require('react-native');
    if (Clipboard?.setString) { Clipboard.setString(value); return true; }
  } catch (e) {
    log.warn('copy failed', e?.message);
  }
  return false;
}
