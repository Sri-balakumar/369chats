// WHERE IS MY SERVER? — the one question a fresh install has to ask.
//
// An app cannot ask a server which server it belongs to, so historically every
// device had to be told by hand: type a URL, wait for the database list, pick
// one, sign in as an admin. Only then could a user reach the mobile-number
// login. That is fine once and unreasonable across a company's phones.
//
// So a build ships knowing ONE fixed address — the anchor — and asks it. The
// answer (url + database) comes from the App Servers row in Odoo, which an admin
// can change at any time; every device adopts the new value on its next cold
// start. Nothing is rebuilt and nobody re-runs setup.
//
// The anchor is the only thing that cannot move. In practice it is a DOMAIN, so
// the machine, the database and the hosting behind it can all change without it.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { jsonRpc } from '../api/odooApi';
import { createLogger } from '../api/logger';

const log = createLogger('AppServer');

/**
 * The anchor answered, and said this app has no server configured — an admin
 * clearing the Client URL or switching the row off.
 *
 * Deliberately distinct from `null` ("could not reach the anchor"), because the
 * two want opposite handling: this is an instruction and must take effect, while
 * an unreachable anchor is a blip that must NOT strand a working device.
 */
export const UNCONFIGURED = 'unconfigured';

// Short: this runs during boot, and a slow anchor must not hold the app on a
// blank screen. Failing fast and carrying on is better than starting late.
const TIMEOUT_MS = 10000;

/**
 * The build-time anchor, or an object with an empty anchorUrl when unset.
 *
 * Environment FIRST, app.json second. The address of a customer's server does
 * not belong in a tracked file, so it lives in a gitignored `.env.local` (or an
 * EAS build profile) and app.json keeps empty defaults. Anyone cloning the repo
 * gets an app that behaves exactly as it did before the anchor existed.
 *
 * Be clear about what this does NOT buy: EXPO_PUBLIC_* is inlined into the
 * bundle at build time, so it is every bit as fixed as app.json — it is simply
 * not committed. Changing the anchor still means a rebuild. Nothing stored in
 * the app can avoid that; only a hosted config file or a per-device setup step
 * would.
 */
export function anchorConfig() {
  const extra = Constants?.expoConfig?.extra || Constants?.manifest?.extra || {};
  const cfg = extra.appServer || {};
  const pick = (envValue, fallback) => String(envValue ?? fallback ?? '').trim();

  // Each of these MUST be written as a literal `process.env.EXPO_PUBLIC_…`
  // member expression. Expo substitutes the value at build time by matching that
  // exact shape in the source; assigning `process.env` to a variable first and
  // reading off it defeats the substitution entirely, leaving `undefined` at
  // runtime with nothing to show for it. That is not a hypothetical — it is how
  // this was written first, and the value silently never reached the bundle.
  return {
    anchorUrl: pick(process.env.EXPO_PUBLIC_APP_ANCHOR_URL, cfg.anchorUrl),
    anchorDb: pick(process.env.EXPO_PUBLIC_APP_ANCHOR_DB, cfg.anchorDb),
    // appKey has a sane default: it identifies THIS app, not the customer, so
    // there is no reason to make every build set it.
    appKey: pick(process.env.EXPO_PUBLIC_APP_KEY, cfg.appKey) || '369chats',
  };
}

/** True when this build has an anchor to ask. Empty = behave exactly as before. */
export function hasAnchor() {
  return anchorCandidates().length > 0;
}

/**
 * The addresses to try, in order, first answer wins.
 *
 * `anchorUrl` may be a COMMA-SEPARATED list, because no single address works
 * everywhere during development:
 *
 *   physical phone    → needs the machine's LAN address
 *   Android emulator  → localhost is the emulator; the host is 10.0.2.2
 *   web / browser     → localhost is right
 *
 * Rather than make someone edit .env.local every time they switch, list them all
 * and let the app find the one that answers. In production this is a single
 * domain and the loop runs once.
 *
 * A localhost entry on Android also queues the 10.0.2.2 form, since that mapping
 * is an emulator quirk nobody should have to remember.
 */
export function anchorCandidates() {
  const { anchorUrl, appKey } = anchorConfig();
  if (!anchorUrl || !appKey) return [];

  const out = [];
  const push = (u) => {
    const clean = String(u || '').trim().replace(/\/+$/, '');
    if (clean && !out.includes(clean)) out.push(clean);
  };

  for (const raw of anchorUrl.split(',')) {
    const u = raw.trim();
    if (!u) continue;
    push(u);
    if (Platform.OS === 'android' && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(u)) {
      push(u.replace(/(localhost|127\.0\.0\.1)/i, '10.0.2.2'));
    }
  }
  return out;
}

/**
 * Ask the anchor which server this app should use.
 *
 * Returns { url, db } or NULL. Never throws — "cannot resolve" has to mean
 * "carry on as before", not an error state, or a flaky network on launch would
 * strand a device that was already working perfectly well.
 */
export async function resolveServer() {
  const { anchorDb, appKey } = anchorConfig();
  const candidates = anchorCandidates();
  if (!candidates.length) return null;

  let sawUnconfigured = false;

  for (const anchor of candidates) {
    try {
      // anchorDb is passed as X-Odoo-Database. It is only needed when the anchor
      // host serves several databases with no dbfilter: Odoo cannot route a
      // public request without knowing the database, and returns 404 instead —
      // exactly what /kpi_app/config already does under the same conditions, so
      // it is not specific to this route.
      //
      // It names the ANCHOR's database, never the target's. The target url+db
      // still come from the Odoo row and stay changeable.
      //
      // Sent with NO COOKIE (the trailing `false`). This route is auth='public'
      // and has no use for a session — and carrying one is actively harmful:
      // Odoo answers a flat 403 when a request holds both a session cookie and
      // the X-Odoo-Database header naming a DIFFERENT database. A device that
      // had once signed in elsewhere therefore had every single resolve refused,
      // for ever, and it looked exactly like the network being down.
      const res = await jsonRpc(
        anchor, '/app/resolve', { app: appKey }, TIMEOUT_MS, anchorDb || null,
        null, false,
      );
      if (res && res.status === true && res.url) {
        const out = { url: String(res.url).replace(/\/+$/, ''), db: res.db || '' };
        log.info('resolved via', anchor, out);
        return out;
      }
      // Reached it, and it says this app has no server. Remember that: it is an
      // instruction, not a failure, and it must survive the remaining
      // candidates being unreachable.
      if (res && res.configured === false) sawUnconfigured = true;
      log.info('no server for this app at', anchor, res?.error || '');
    } catch (e) {
      // A 403 here is NOT the network. Odoo returns it when the request carries
      // a session cookie for one database and the header names another, so
      // saying "unreachable" sends whoever reads this log hunting a fault that
      // does not exist. The call above no longer sends a cookie, so this should
      // now be unreachable in both senses — but if it ever comes back, it should
      // arrive named.
      if (e?.response?.status === 403) {
        log.warn('anchor refused: a stale session disagrees with the database', anchor);
      } else {
        // Genuinely unreachable from here: wrong for this platform (localhost on
        // a real phone), off the network, or down. Try the next.
        log.info('anchor unreachable', anchor, e?.message);
      }
    }
  }

  // Reached the anchor, and it said "not configured". That is a decision, so it
  // is reported as one — the caller drops the stored server rather than carrying
  // on against a server the admin has switched off.
  if (sawUnconfigured) {
    log.info('anchor says this app is not configured');
    return UNCONFIGURED;
  }

  // Nothing answered at all. Not something the user can act on mid-launch, and
  // NOT a reason to forget a server that was working — the caller keeps what it
  // has, exactly as it did before an anchor existed.
  log.warn('no anchor answered', { tried: candidates.length });
  return null;
}
