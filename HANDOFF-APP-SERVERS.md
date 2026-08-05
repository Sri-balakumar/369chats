# App Servers + number-only login — session handoff

Companion to `HANDOFF.md`. That file covers the chat app; this covers the subsystem added on
**2026-08-04**: an admin sets one row in Odoo and every phone follows it, so users only ever type
their mobile number.

**Nothing in this document is confirmed on a device.** `jest` (98), `expo-doctor` (18/18) and
`expo export` all pass, and every server route was exercised over HTTP — but the app half has only
been reasoned about and traced, never watched working. Treat device testing as owed.

---

## The problem it solves

Every phone used to be set up by hand: type a server URL, wait for a database list, pick one, sign in
as an Odoo admin. Only then could a user sign in. Fine once, unreasonable across a company.

**The bootstrap constraint that shapes everything:** an app cannot ask a server which server it
belongs to. Something must be known first. So a build ships knowing ONE address — the *anchor* — and
asks it where to actually connect. The anchor is the only fixed thing; the server and database
behind it change freely from Odoo.

```
build knows: anchorUrl ──► /app/resolve {app:"369chats"}
                       ◄── { url, db }         from the App Servers row
             save it ──► "Enter your mobile number"
                     ──► /kpi_app/login_check  → is this number registered?
                     ──► /kpi_app/login        → signed in
```

---

## What exists

### Odoo — two modules, installed on `sales_test`

| Module | Role | Depends on |
|---|---|---|
| `app_server_config` | server rows + `/app/resolve` | `base`, `web` **only** |
| `app_login_369` | who may sign in, on what number | + `whatsapp_neonize`, `app_server_config` |

The split is deliberate: the core installs on any Odoo, for any app, and knows nothing about people.

**`kra_kpi_module` is not modified, and nothing depends on it any more.**

* **App Servers ▸ Servers** — app key, Client URL, Database (dropdown, auto-fetched from the URL),
  and one live row at a time. Switching is a confirmed button that reloads. A header button goes to
  App Login ▸ Users; it is a widget (`app_login_369/static/src/app_login_link/`) rather than a
  `type="action"` button so it lands on the App Login *page* instead of opening the users list
  inside App Servers.
* **App Login ▸ Users** — the one place app login is managed. Name + login, role, country + `+91`
  number, last login, last device, login toggle, Reset. Its own fields (`app_login_mobile`,
  `app_login_enabled`), seeded once from KRA and independent afterwards.

> **There used to be a third module, `app_server_config_kpi`** — a bridge holding a second copy of
> the users screen, backed by kra's `kpi_mobile_number`. It was **deleted on 2026-08-05**, files and
> all: it was `auto_install`, so uninstalling alone would have brought it straight back. Two
> identically-labelled "App Login Users" buttons on one form, one of which showed everybody's role
> as "User" because it mapped kra's *developer* to that label, is what it cost. If you find a
> reference to it, it is stale.

### App

* `services/appServer.js` — `resolveServer()`, comma-separated anchor list, first to answer wins.
* `App.js` — provisions at boot; a **watcher** re-checks on foreground-resume and on a timer
  (**8s signed out**, 60s signed in).
* `api/session.js` — `clearConnection()`, `saveLastMobile()`/`getLastMobile()`.
* Red banners: on the login screen and under the **369Chats** title in the chat list.

### Behaviour, as traced

| Situation | App does |
|---|---|
| Fresh install, anchor set | asks, saves, → number screen |
| Client URL cleared in Odoo | signs out, *"no server set up"* |
| Row points somewhere else | signs out, *"workspace has moved"*, number pre-filled |
| **Anchor unreachable** | **nothing** — keeps working on the last known server |
| Signed out, admin sets the URL | banner clears within ~8s, login works |
| Number not registered | *"This number is not registered…"* |
| No server + number entered | *"This app has no server set up yet"* — does **not** call login_check |

That "unreachable does nothing" row is load-bearing. The watcher ticks constantly; treating a
dropped packet as "log out" would make the app unusable on a weak signal. **Only a deliberate change
signs anyone out.**

---

## Two flags that hide things

```js
// App.js
const NUMBER_LOGIN_ENABLED = true;    // mobile-number sign-in
const DEVICE_SETUP_ENABLED = false;   // the 7-tap → Odoo login door — LOCKED
```

`DEVICE_SETUP_ENABLED` is off by request. ConnectScreen and its flow are intact; flip to `true` to
restore the hidden door. **Keep it in mind as the recovery path** — if the anchor is ever wrong,
that door is how a device gets pointed by hand.

**`NUMBER_LOGIN_ENABLED` was `false` when this session started**, which is why provisioning appeared
to do nothing for hours: `provisioned` only leads anywhere through the branch it gates.

---

## Gotchas — each one cost real time

1. **`process.env.EXPO_PUBLIC_*` must be a literal member expression.** Writing
   `const env = process.env; env.EXPO_PUBLIC_X` defeats Expo's build-time substitution and yields
   `undefined` with no warning. The anchor silently never reached the bundle.
2. **A public Odoo route 404s on a multi-DB server** with `dbfilter` empty — this one hosts 9. The
   app already handles it: `api/odooApi.js` sends `X-Odoo-Database`. `/kpi_app/config` fails the same
   way, which is how you tell it is not your bug.
3. **`active` is a magic field name in Odoo.** The web client hides those rows from lists, so
   switching servers made the previous row vanish and read as "deleted". The live switch is
   `is_live`, a plain boolean — and `_resolve` must filter on it **explicitly**, since a plain field
   gets none of the automatic filtering.
4. **`post_init_hook` does not run on `-u`.** A field added to existing rows needs
   `migrations/<version>/post-migrate.py`, or every row keeps the default.
5. **Clearing a session in storage is not enough** — the in-memory copy read moments earlier must be
   suppressed too, or the app restores it and carries on as if nothing happened.
6. **Grepping a Hermes `.hbc` gives false negatives.** Strings with non-ASCII (an em-dash) are
   UTF-16, and shared fragments are deduped. `grep -a` sometimes finds a prefix and never the whole
   string. Do not conclude from it that a value is missing.
7. **`editable="bottom"` on a list** makes **New** add an inline row, so the form — where the real
   work happens — never opens.
8. **Odoo 19 dropped `_sql_constraints`** and ignores it silently. Use `models.Constraint`.
9. **`-i` vs `-u`**: `-i` on an installed module and `-u` on a new one are both silent no-ops that
   exit 0. So is `-d` pointed at the wrong database. Always verify state afterwards.
10. **A blank Client URL used to fall back to the requesting host**, which made clearing the field
    do nothing. Blank now means "not configured", and `/app/resolve` returns
    `configured: false` so the app can tell "switched off" from "unreachable".

---

## Deploy

```powershell
net stop "odoo-server-19.0"          # needs Administrator, or robocopy skips locked files
robocopy "C:\Projects\369Chats\odoo_modules\app_server_config" `
  "C:\Program Files\Odoo 19.0.20260119\server\odoo\addons\app_server_config" /MIR /XD __pycache__
robocopy "C:\Projects\369Chats\odoo_modules\app_login_369" `
  "C:\Program Files\Odoo 19.0.20260119\server\odoo\addons\app_login_369" /MIR /XD __pycache__
& "C:\Program Files\Odoo 19.0.20260119\python\python.exe" `
  "C:\Program Files\Odoo 19.0.20260119\server\odoo-bin" `
  -c "C:\Program Files\Odoo 19.0.20260119\server\odoo.conf" `
  -d sales_test -u app_server_config,app_login_369 --stop-after-init
net start "odoo-server-19.0"
```

Verify — the exit code will not tell you:

```sql
SELECT name, state FROM ir_module_module
 WHERE name IN ('app_server_config','app_login_369');
SELECT app_key, is_live, client_url, client_db, db_checked_url FROM app_server_config;
```

After any JS change, **Ctrl+Shift+R** in the browser. PowerShell died twice this session with a
paging-file error (`0x800705AF`) and PostgreSQL went into recovery once — both memory pressure on
this machine. Bash worked when PowerShell would not.

---

## App: switching it on

The anchor lives in a **gitignored `.env.local`** (`.env.example` documents it):

```
EXPO_PUBLIC_APP_ANCHOR_URL=http://10.93.4.175:8069,http://localhost:8069
EXPO_PUBLIC_APP_ANCHOR_DB=sales_test
```

Comma-separated, tried in order — no single address works everywhere (phone needs the LAN address,
Android emulator needs `10.0.2.2`, browser needs localhost; a localhost entry auto-adds the
`10.0.2.2` form on Android). **Unset = the app behaves exactly as before**, which is also the fastest
way to answer "did this break anything?".

Metro reads env vars **at startup** — `npx expo start -c` after editing, and look for
`env: load .env.local` in the output.

---

## Still open

* **The LAN anchor is testing-only.** Unreachable on mobile data. Needs the live domain before
  shipping — that value is the one thing a rebuild is required to change.
* **The live row has no Client URL right now**, so `/app/resolve` answers `configured: false` and
  every phone shows the red "contact your admin" banner. That is the switch working, not a fault —
  but the app is off until somebody types an address into App Servers ▸ Servers.
* **4 of 21 internal users have no `app_login_mobile`** (Demo Alice, Demo Bob, Demo Carol, Marc
  Demo). They have no number in KRA either, so there is nothing to import — with the Odoo login
  locked they cannot get into the app until one is typed on App Login ▸ Users.
* **Nothing here is device-tested.** Highest value next step: `npx expo start -c`, then watch
  clearing the Client URL sign the app out, and setting it clear the banner.
* Everything from this session is **uncommitted** except the Odoo modules (pushed as `041e4b9`,
  `7081185` — the latter added `app_server_config_kpi`, which has since been deleted).
* From earlier batches, unrelated: video calls cut off (needs one repro with the in-app debug log
  on), TURN unset, group photo, invite reset, `admin_approve`, jump-to-date, multi-select,
  @mentions, media-viewer overhaul, video poster frames.
