// The route contract between the app and app_login_369.
//
// WHY THIS FILE EXISTS
//
// The app spent this whole subsystem's life calling kra_kpi_module's /kpi_app/*
// routes, which read a DIFFERENT column (`kpi_mobile_number`) from the one the
// admin screen edits (`app_login_mobile`). Both held the same numbers because an
// install hook copied one into the other once, so everything worked — right up
// until somebody edited a number, which would have reached nobody. Nothing on
// either side would have said so, and no test would have caught it.
//
// So these tests assert the thing that was actually wrong: WHICH URL is called,
// and WHAT is in the body. They deliberately do not exercise Odoo — the server
// side is verified against the real server — they pin the wire format, because
// that is where the two halves silently disagreed.
import {
  start, verifyCode, signUp, passwordLogin, setAppPassword,
  digitsOf, formatLoginMobile, MIN_DIGITS, MAX_DIGITS,
} from '../services/appAuth';
import { jsonRpc } from '../api/odooApi';
import { getConnection } from '../api/session';

jest.mock('../api/odooApi', () => ({ jsonRpc: jest.fn() }));
jest.mock('../api/session', () => ({ getConnection: jest.fn() }));
jest.mock('expo-device', () => ({ deviceName: 'Test Phone', modelName: 'Test' }));
jest.mock('../api/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const CONN = { serverUrl: 'https://srv.example', db: 'testdb', setupUid: 7 };

// The URL and the body of the last call, which is what these tests are about.
const lastCall = () => {
  const [url, path, body] = jsonRpc.mock.calls[jsonRpc.mock.calls.length - 1];
  return { url, path, body };
};

beforeEach(() => {
  jest.clearAllMocks();
  getConnection.mockResolvedValue(CONN);
});

describe('every call goes to app_login_369, never to kra', () => {
  // The regression this whole file was written for. A /kpi_app/ path here means
  // the app is reading a column the admin screen does not write.
  test.each([
    ['start', () => start('9876543210')],
    ['verify', () => verifyCode('9876543210', '123456')],
    ['signup', () => signUp('9876543210', { code: '123456', name: 'A' })],
    ['password', () => passwordLogin('9876543210', 'secret')],
    ['set_password', () => setAppPassword('secret')],
  ])('%s hits /app_login/*', async (_name, call) => {
    jsonRpc.mockResolvedValue({ status: true });
    await call();
    expect(lastCall().path).toMatch(/^\/app_login\//);
    expect(lastCall().path).not.toMatch(/kpi_app/);
  });

  test('the database is passed through on every call', async () => {
    jsonRpc.mockResolvedValue({ status: true });
    await start('9876543210');
    // Fourth argument. A public route on a multi-DB server 404s without it, and
    // the failure looks like "the server is down" rather than "wrong database".
    expect(jsonRpc.mock.calls[0][4]).toBe('testdb');
  });
});

describe('the device lock is enforceable', () => {
  // The server refuses a sign-in on a device bound to someone else, but only if
  // the app tells it which device this is. Dropping setup_uid would disable that
  // check silently — every login would simply start succeeding.
  test.each([
    ['start', () => start('9876543210')],
    ['verify', () => verifyCode('9876543210', '123456')],
    ['password', () => passwordLogin('9876543210', 'secret')],
  ])('%s sends setup_uid', async (_name, call) => {
    jsonRpc.mockResolvedValue({ status: true });
    await call();
    expect(lastCall().body.setup_uid).toBe(7);
  });
});

describe('start — the one decision', () => {
  test('a known number answers login, and the code was sent', async () => {
    jsonRpc.mockResolvedValue({ status: true, mode: 'login', sent: true, name: 'Aarav' });
    const res = await start('98765 43210', { countryCode: 'IN' });
    expect(res).toMatchObject({ mode: 'login', sent: true, name: 'Aarav' });
    expect(lastCall().body).toMatchObject({ mobile: '9876543210', country_code: 'IN' });
  });

  test('a new number answers signup', async () => {
    jsonRpc.mockResolvedValue({ status: true, mode: 'signup', sent: true });
    expect((await start('9876543210')).mode).toBe('signup');
  });

  test('authorised but undelivered is NOT reported as sent', async () => {
    // WhatsApp is one scanned session and it can be down. A screen that reads
    // mode:'login' as "a code is coming" leaves people waiting for a message
    // nobody sent — so `sent` has to survive separately from `mode`.
    jsonRpc.mockResolvedValue({ status: true, mode: 'login', sent: false });
    const res = await start('9876543210');
    expect(res.mode).toBe('login');
    expect(res.sent).toBe(false);
  });

  test('blocked carries the reason', async () => {
    jsonRpc.mockResolvedValue({
      status: true, mode: 'blocked', error: "This number isn't registered.",
    });
    expect(await start('9876543210')).toMatchObject({
      mode: 'blocked', error: "This number isn't registered.",
    });
  });

  test('an unparseable answer is blocked, not let through', async () => {
    jsonRpc.mockResolvedValue({});
    expect((await start('9876543210')).mode).toBe('blocked');
  });

  test('no server configured never reaches the network', async () => {
    getConnection.mockResolvedValue({ serverUrl: '', db: '', setupUid: null });
    expect((await start('9876543210')).mode).toBe('blocked');
    expect(jsonRpc).not.toHaveBeenCalled();
  });
});

describe('verify — sign in by code', () => {
  test('returns the user to persist', async () => {
    jsonRpc.mockResolvedValue({
      status: true, uid: 12, name: 'Aarav', login: 'aarav', must_change: false,
    });
    const res = await verifyCode('9876543210', '12 34 56', { dial: '91' });
    expect(res.ok).toBe(true);
    expect(res.user).toMatchObject({
      uid: 12, name: 'Aarav', username: 'aarav',
      db: 'testdb', serverUrl: 'https://srv.example',
      mobile: '+91 9876543210',
    });
    // Spaces stripped from the code before it goes out.
    expect(lastCall().body.code).toBe('123456');
  });

  test('a bad code fails with the server wording and no user', async () => {
    jsonRpc.mockResolvedValue({ status: false, error: 'Incorrect or expired code.' });
    const res = await verifyCode('9876543210', '000000');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Incorrect or expired code.');
    expect(res.user).toBeUndefined();
  });

  test('never sends a password — that is the whole point of this route', async () => {
    jsonRpc.mockResolvedValue({ status: true, uid: 1 });
    await verifyCode('9876543210', '123456');
    expect(lastCall().body).not.toHaveProperty('password');
    expect(lastCall().body).not.toHaveProperty('new_password');
  });
});

describe('signup — name only, like WhatsApp', () => {
  test('sends an empty password when none was chosen', async () => {
    // The server accepts this and stores no hash, so the code stays the way in.
    // If this ever starts sending a made-up password, people acquire a secret
    // they were never told about.
    jsonRpc.mockResolvedValue({ status: true, uid: 30, name: 'New', login: '9876543210' });
    const res = await signUp('9876543210', {
      code: '123456', name: 'New', countryCode: 'IN', dial: '91',
    });
    expect(res.ok).toBe(true);
    expect(lastCall().body).toMatchObject({
      mobile: '9876543210', code: '123456', name: 'New', password: '', country_code: 'IN',
    });
  });

  test('passes a password through when one was chosen', async () => {
    jsonRpc.mockResolvedValue({ status: true, uid: 30 });
    await signUp('9876543210', { code: '123456', name: 'New', password: 'hunter2' });
    expect(lastCall().body.password).toBe('hunter2');
  });

  test('account created but not signed in is reported as created', async () => {
    // Retrying would be refused as a duplicate, so the screen has to know the
    // difference between "that failed" and "that worked, now sign in".
    jsonRpc.mockResolvedValue({ status: true, logged_in: false, uid: 30, name: 'New' });
    const res = await signUp('9876543210', { code: '123456', name: 'New' });
    expect(res.ok).toBe(false);
    expect(res.created).toBe(true);
  });
});

describe('password — the fallback', () => {
  test('signs in and returns the user', async () => {
    jsonRpc.mockResolvedValue({ status: true, uid: 5, name: 'A', login: 'a', must_change: true });
    const res = await passwordLogin('9876543210', 'secret', { dial: '968' });
    expect(res.ok).toBe(true);
    expect(res.mustChange).toBe(true);
    expect(res.user.mobile).toBe('+968 9876543210');
  });
});

describe('number handling', () => {
  test('digitsOf strips everything that is not a digit', () => {
    expect(digitsOf('+91 98765-43210')).toBe('919876543210');
    expect(digitsOf(null)).toBe('');
  });

  test('formatLoginMobile falls back to bare digits with no dial code', () => {
    expect(formatLoginMobile('9876543210', '91')).toBe('+91 9876543210');
    expect(formatLoginMobile('9876543210', '')).toBe('9876543210');
    expect(formatLoginMobile('', '91')).toBe('');
  });

  test('the digit bounds match what the server accepts', () => {
    // 4-15 is the international range for a LOCAL number. If these drift apart,
    // the app rejects numbers the server would have taken, or vice versa.
    expect(MIN_DIGITS).toBe(4);
    expect(MAX_DIGITS).toBe(15);

  });
});
