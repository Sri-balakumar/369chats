// Mobile-app auth — the /app_login/* routes of the app_login_369 Odoo module.
//
// WHY NOT /kpi_app/* ANY MORE
//
// Those belong to kra_kpi_module and read `kpi_mobile_number`. App Login ▸ Users
// edits `app_login_mobile`. They are different columns, and they agreed only
// because the install hook copied one into the other once — so the first number
// an admin changed on that screen would not have reached the app, with nothing
// on either side to say why. kra's routes still work; the app just no longer
// uses them.
//
// THE SHAPE OF THE FLOW
//
// One decision, made by the server. `start()` takes a number and answers
// 'login', 'signup' or 'blocked' — the app never asks the user which they are,
// the same way WhatsApp never does. It also SENDS the code in that same call,
// so there is no window where the app thinks a code is coming and none was.
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { getConnection } from '../api/session';
import { jsonRpc, clearServerSession } from '../api/odooApi';
import { createLogger } from '../api/logger';

const log = createLogger('AppAuth');


// The international range for a LOCAL number, minus the country code. The server
// applies the same bounds and is the one that actually decides, by whether the
// number matches anybody.
export const MIN_DIGITS = 4;
export const MAX_DIGITS = 15;

function deviceName() {
  return Device.deviceName || Device.modelName || Platform.OS || 'device';
}

export function digitsOf(mobile) {
  return String(mobile || '').replace(/\D/g, '');
}

// Every call below goes through this, so a stale session cannot lock the app out.
//
// Odoo answers a flat 403 — before routing, with no body — to any request
// carrying a session cookie for one database alongside the X-Odoo-Database
// header naming another. A phone that had once signed in against a different
// database was then refused on EVERY call, for ever, and the app had no way back
// because the calls that might fix it were refused too. The only cure was
// clearing the app's storage by hand.
//
// So: on a 403, throw the old session away and try once more. Exactly once — a
// second 403 means something other than a stale cookie, and retrying a real
// refusal in a loop is how you end up hammering a server telling you to stop.
// Argument order mirrors jsonRpc exactly (…, timeout, db) so call sites read the
// same and `db` cannot quietly land in the wrong slot — which would drop the
// X-Odoo-Database header and turn every request into a 404.
async function call(serverUrl, path, params, timeout, db) {
  try {
    return await jsonRpc(serverUrl, path, params, timeout, db);
  } catch (e) {
    if (e?.response?.status !== 403) throw e;
    log.warn('403 — clearing a stale session and retrying once', path);
    // Odoo's own /web/session/logout, not a route of ours. See
    // clearServerSession: it is auth="none" and therefore needs no database,
    // which is the only reason it can run at all when the stale session points
    // at a database that has none of our modules installed.
    await clearServerSession(serverUrl);
    return jsonRpc(serverUrl, path, params, timeout, db);
  }
}

// "+91 9876543210" for storing on the session, so the profile shows the number
// the way it was dialled. The dial code comes from the country the user picked —
// there is no server setting for it any more, and there should not be: the
// person entering the number knows better than a company default.
export function formatLoginMobile(mobile, dial) {
  const d = digitsOf(mobile);
  if (!d) return '';
  return dial ? `+${dial} ${d}` : d;
}

// The one decision. Returns:
//   { mode: 'login'  }  registered — a sign-in code has been sent
//   { mode: 'signup' }  not registered, sign-up is on — a sign-up code has been sent
//   { mode: 'blocked', error }  nothing was sent, and error says why
//
// `sent` is carried through separately from `mode` on purpose: the server can
// decide someone may sign in and still fail to deliver the code, because
// WhatsApp is one connected session and it can be down. A screen that treats
// mode:'login' as "a code is on its way" leaves people waiting for a message
// that was never sent.
export async function start(mobile, { countryCode } = {}) {
  const { serverUrl, db, setupUid } = await getConnection();
  if (!serverUrl) return { mode: 'blocked', error: 'This app has no server set up yet.' };
  const res = await call(serverUrl, '/app_login/start', {
    mobile: digitsOf(mobile),
    // An ISO CODE, never a res.country id. The app carries its own country list
    // so the picker works before any server is reached, and those ids are
    // per-database — an id meaning India here can mean somewhere else on the
    // server this app is pointed at next.
    country_code: countryCode || '',
    setup_uid: setupUid || 0,
  }, undefined, db);
  log.info('start ←', { mode: res?.mode, sent: res?.sent });
  return {
    mode: res?.mode || 'blocked',
    sent: !!res?.sent,
    name: res?.name || '',
    error: res?.error || '',
    retryAfter: res?.retry_after || 0,
    // Present only while the server's dev auto-fill switch is on. The screen
    // fills the boxes with it so this flow can be tested before WhatsApp is
    // connected; it is absent in any normal deployment.
    devCode: res?.dev_code || '',
  };
}

// Sign in with the code. Never touches the password.
export async function verifyCode(mobile, code, { dial } = {}) {
  const { serverUrl, db, setupUid } = await getConnection();
  if (!serverUrl) return { ok: false, error: 'This app has no server set up yet.' };
  const res = await call(serverUrl, '/app_login/verify', {
    mobile: digitsOf(mobile),
    code: digitsOf(code),
    device: deviceName(),
    setup_uid: setupUid || 0,
  }, undefined, db);
  if (!res?.status) return { ok: false, error: res?.error || 'Could not verify.' };
  return {
    ok: true,
    mustChange: !!res.must_change,
    user: {
      name: res.name, username: res.login, uid: res.uid, db, serverUrl,
      mobile: formatLoginMobile(mobile, dial),
    },
  };
}

// Create an account with the code, then sign in. `password` is OPTIONAL —
// leaving it blank means signing in by code every time, which is the WhatsApp
// behaviour and the default here.
export async function signUp(mobile, { code, name, password = '', countryCode, dial } = {}) {
  const { serverUrl, db } = await getConnection();
  if (!serverUrl) return { ok: false, error: 'This app has no server set up yet.' };
  const res = await call(serverUrl, '/app_login/signup', {
    mobile: digitsOf(mobile),
    code: digitsOf(code),
    name,
    password,
    country_code: countryCode || '',
    device: deviceName(),
  }, undefined, db);
  if (!res?.status) return { ok: false, error: res?.error || 'Could not create the account.' };
  // The account can exist while the session did not take — the server says so
  // rather than implying the sign-up failed, and so do we.
  if (res.logged_in === false) {
    return { ok: false, created: true, error: 'Account created. Please sign in.' };
  }
  return {
    ok: true,
    user: {
      name: res.name, username: res.login, uid: res.uid, db, serverUrl,
      mobile: formatLoginMobile(mobile, dial),
    },
  };
}

// The fallback, for when WhatsApp is down. Kept because a login that cannot
// survive one scanned session dropping is one that locks out a whole company at
// the moment nobody can do anything about it.
export async function passwordLogin(mobile, password, { dial } = {}) {
  const { serverUrl, db, setupUid } = await getConnection();
  if (!serverUrl) return { ok: false, error: 'This app has no server set up yet.' };
  const res = await call(serverUrl, '/app_login/password', {
    mobile: digitsOf(mobile),
    password,
    device: deviceName(),
    setup_uid: setupUid || 0,
  }, undefined, db);
  if (!res?.status) return { ok: false, error: res?.error || 'Login failed.' };
  return {
    ok: true,
    mustChange: !!res.must_change,
    user: {
      name: res.name, username: res.login, uid: res.uid, db, serverUrl,
      mobile: formatLoginMobile(mobile, dial),
    },
  };
}

// The signed-in user sets or replaces their own app password.
export async function setAppPassword(newPassword) {
  const { serverUrl, db } = await getConnection();
  if (!serverUrl) return { ok: false, error: 'This app has no server set up yet.' };
  const res = await call(serverUrl, '/app_login/set_password',
    { new_password: newPassword }, undefined, db);
  return { ok: !!res?.status, error: res?.error };
}
