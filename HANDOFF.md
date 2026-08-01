# 369Chats — session handoff

Paste this whole file into a new session as context.

## What this is

`c:\Projects\369Chats` is an Expo 54 / RN 0.81 chat app talking to the Odoo 19 module
`odoo_modules/chats_369`. **Two clients, one product**: the RN app and the module's OWL web client
(`static/src/chat_app/`). The module is the design source of truth.

**Standing rule: every fix lands in BOTH clients.** If a behaviour changes in one, check the other
before calling it done. Where a rule is enforceable server-side (windows, permissions), put it in
`chat_api.py` and have both clients read a server-computed flag rather than each re-deriving it.

---

## Read this before writing any code — hard-won gotchas

1. **Cookie auth breaks every image.** `/chats_369/media/*` and `/chats_369/avatar/*` are
   `auth='user'`. RN's `<Image>` and `expo-file-system`'s `downloadAsync` each keep their own cookie
   store and fail *silently*. Go through `components/chat/AuthImage.js` or `utils/downloadAuthed.js`.

2. **Nested `TouchableOpacity` swallows the outer gesture on Android.** Media is a plain `View`; the
   bubble carries the tap. `LinkedText` threads `onLongPress` into every span.

3. **Edge-to-edge is on.** `KeyboardAvoidingView` does nothing on Android. Use
   `utils/useKeyboardHeight.js` and pad by `kb > 0 ? kb + insets.bottom : insets.bottom`.

4. **Realtime is now bus + polling, and BOTH matter.** `services/odooBus.js` is a real websocket
   subscription (the native cookie module arrived with the calling work). `services/chatRealtime.js`
   still polls every 3s (thread) / 6s (list) alongside it and **stops when backgrounded**. Keep both:
   the bus is best-effort and a dropped socket on a phone is routine, so polling is the safety net —
   the OWL web client does exactly the same. Poll cadence was deliberately NOT slowed yet, so a bus
   bug shows up as "slightly late" rather than "silently broken".
   Call events (`call_ring` / `call_accept` / `call_signal` / …) exist **only** on the bus — no
   amount of polling will ever surface them.

5. **Odoo returns `false`, never `null`.** Normalised in `services/chat.js`. Failures come back HTTP
   200 as `{status: false, message: '...'}` — the key is `message`, not `error`.

6. **Two RN `<Modal>`s cannot stack on Android.** Opening a `PopupModal` from inside a `MenuPopup`'s
   `onPress` silently shows nothing. That is why `components/ui/ConfirmDialog.js` is an **in-tree
   absolutely-positioned layer**, not a Modal. Use it for confirmations.

7. **`StyleSheet.create` bakes colours at import.** Use `themed((C) => ({...}))` from `theme.js`
   instead. `__tests__/themeStatic.test.js` fails the build if any `StyleSheet.create` block
   references a theme token.

8. **`react-native-svg` percentage sizing is unreliable on Android** without a viewBox — measure with
   `onLayout` and pass pixels.

9. **Server rules that look like client bugs:** empty 1:1 not listed until it has a message; max 3
   pinned messages / 3 pinned chats; pins always carry an expiry (1/7/14/30 days); edit window 15 min
   author-only; **delete-for-everyone 24h author-only**; mute suppresses push only; Google Meet is
   admin-only by default; `/chat/search_all` needs 2+ chars.
10. **A wildcard peer dep can silently poison the native build.** The 2026-07-31 build crashed on
   every launch with `NoClassDefFoundError: expo/modules/kotlin/types/AnyTypeCache` inside
   `AssetModule`. Cause: `expo-audio` declares `expo-asset` as peer `"*"`, npm answered the wildcard
   with the newest published version — `expo-asset@57`, an **SDK 57** package — and hoisted it to
   top-level `node_modules`, pushing `expo@54`'s correct `~12.0.13` down into `node_modules/expo/`.
   Gradle autolinks whatever sits at the **top level**, so the SDK 57 `AssetModule` was compiled
   against `expo-modules-core@3.0.30`. `expo-modules-core` uses **inline reified** functions, so
   `AnyTypeCache` is inlined into consumers — which is why the missing class surfaced in
   `expo-asset` rather than in core, and why RN died building its native module registry before any
   JS ran (one splash frame, then gone).
   Fixed by a direct `expo-asset` dependency **plus** an `overrides` block in `package.json` — the
   direct dep fixes the current tree, the override stops the wildcard re-hoisting 57 on the next
   `npm install`. **`npx expo-doctor` catches this class of fault in seconds; nothing else does.**
   Verify a fix with what Gradle actually sees, not what package.json says:
   `npx expo-modules-autolinking resolve -p android --json`.

11. **Release builds log nothing unless you switch it on.** `api/logger.js` defaults to `__DEV__`,
   so a production APK is silent — which is why the crash above needed a USB cable. There is now a
   runtime switch: **Chat settings → Connection → Debug log**, which captures into a ring buffer and
   shares it as a file, no PC required. `redact()` runs automatically on the way *into* the buffer
   (it used to be opt-in per call site) precisely because that buffer can leave the device.

12. **Expo Go cannot run this app — ever.** Scanning a QR from `expo start` red-screens at launch:
   `Invariant Violation: @react-native-community/cookies: import libraries to android`. That is not
   a bug and not a regression. Expo Go is a fixed container and has none of this app's native
   modules — `react-native-webrtc`, `@react-native-cookies/cookies`, `@notifee/react-native`.
   Cookies just throws first, and its message still names the library's *old* package
   (`@react-native-community/…`), which sends you hunting in the wrong place entirely.
   **Always launch the installed 369Chats APK.** Calling, the bus and push exist only in a real build.

13. **The websocket is a SECOND Odoo process, and it is now a service.** `/websocket` is served only
   by the evented (gevent) worker on `gevent_port` (8072) — never by the main server on 8069. It runs
   as the Windows service **`odoo-gevent-19.0`** (auto-start), via
   `server\odoo-gevent.bat`. The wrapper exists because nssm mangles quoted paths containing spaces;
   `gevent` must be argv[1] (that is what sets `odoo.evented`) and `--max-cron-threads=0` is
   deliberate — cron in that worker blocks the gevent loop and takes the websocket down with it.
   If that service is not running, calls silently never ring and nothing is logged anywhere.

---

## Deploying the Odoo module — verified working

Odoo 19 runs as service `odoo-server-19.0`. **The Claude Code shell is elevated**, so this can be
run directly — no need to ask for an admin CMD.

> **The database is `sales_test`, NOT `369application`.** This was wrong in earlier versions of this
> file and cost a session. `chats_369` is `installed` in `sales_test` (17 `chat_*` tables, all 11
> `ir.rule` records); in `369application` it is `uninstalled` with no chat tables at all. That
> matters because **`-u` on an uninstalled module is a silent no-op that still exits 0** — the very
> signal this section tells you to trust. Confirm before believing a deploy:
> ```sql
> SELECT name, state FROM ir_module_module WHERE name = 'chats_369';
> ```
> psql lives at `C:\Program Files\Odoo 19.0.20260119\postgresql\bin\psql.exe`, credentials
> `openpg` / `openpgpwd` (from `server\odoo.conf`).

```powershell
Stop-Service -Name 'odoo-server-19.0' -Force
robocopy "C:\Projects\369Chats\odoo_modules\chats_369" "C:\Program Files\Odoo 19.0.20260119\server\odoo\addons\chats_369" /MIR /NFL /NDL /NJH /NJS
& "C:\Program Files\Odoo 19.0.20260119\python\python.exe" "C:\Program Files\Odoo 19.0.20260119\server\odoo-bin" -c "C:\Program Files\Odoo 19.0.20260119\server\odoo.conf" -d sales_test -u chats_369 --stop-after-init
Start-Service -Name 'odoo-server-19.0'
```
robocopy 0–7 = success (3 = copied + extras removed); **8+ = stop**. odoo-bin exit 0 is necessary
but NOT sufficient — see the box above. Then **Ctrl+Shift+R** — Odoo serves compiled bundles.
Syntax-check first: `python -m py_compile` for controllers,
`node --input-type=module --check` for `chat_app.js`.

**Currently undeployed:** `chat_api.py`, `chat_app.js` and `chat_app.scss` are committed but differ
from the addons copy (media-list `mimetype`, presence/`about` on contact info).

To check whether a deploy is even needed: `diff -rq <source> <addons copy>`.

## Verification

```bash
npx expo-doctor                              # 18/18 — native version drift
npx jest                                     # 91 passing
npx expo export --platform android --clear   # catches unresolved imports
```

**`expo-doctor` is not optional and jest+export do NOT substitute for it.** Both of those are
JS-only; neither looks at which *native* module gets autolinked. An `expo-asset` mismatch passed
both and still crashed every build on launch — see gotcha 10. Keep doctor at 18/18 so a real
failure is visible; the three React Native Directory exclusions in `package.json` are documented
there with the reason each is knowingly accepted.
Test files: `__tests__/theme.test.js`, `__tests__/themeStatic.test.js`,
`components/ui/__tests__/{ui,modules}.test.js`, `screens/__tests__/screens.render.test.js`.
**Add every new screen/component to `modules.test.js`.** The render test catches
"Property 'X' doesn't exist" errors that `expo export` does not.

Native modules have no JS off-device, so anything importing one needs a mock in `jest.setup.js`
or the suite fails at import — `react-native-webrtc` and `@react-native-cookies/cookies` are
mocked there. Those fakes are only enough to *construct*: real call negotiation needs two peers
and a media stack, so it is a device test, never a jest one.

---

## State: what works now

**Theming** — light only, **7 accent variants** (clean/ocean/emerald/sunset/violet/graphite/rose)
taken from the web module's own CSS variables. Dark mode was **removed from both clients** by request.
`theme.js` composes a palette per accent; `themed()` builds one StyleSheet per accent.

**Shipped this session (app):** view-once (chip, consume-on-open, no share, "Opened"), message info
panel, copy (real clipboard via `utils/clipboard.js`), reply privately, transcript export, per-chat
drafts + "Draft:" row preview, optimistic send with rollback, upload %, in-chat search highlight +
n/N stepper, audio scrub + 1×/1.5×/2× + clean stop, now-playing bar on the chat list, poll dialog
centred, About presets, log out in ⋮, `+` on the tab-pill line, notification tap opens the chat,
scheduled calls (create/cancel), un-favourite, attach-sheet photo permission fixed.

**Shipped this session (module):** 8 missing `ir.rule` records (lists/nicknames/poll votes/polls/
options/reactions/calls/schedules had **none**); media route now checks `left_at` +
`hidden_for_user_ids` + `expire_at`; group-avatar membership check + private caching; `/chat/call/ice`
requires membership before releasing TURN creds; `set_nickname` relationship check; `create_list`
int() guard; 24h delete-for-everyone; call relay `is_group` + `call_id` validation; 8 bare
`{status:false}` returns given messages; `_push_call` payload now carries `chat_id`/`call_id`/`video`
and honours the kill-switch + per-user prefs; trigger word no longer posted as a message.

---

## CALLING — written, NOT yet confirmed on a device

The server side was always complete and is unchanged. The app side is now written:

| | |
|---|---|
| `services/odooBus.js` | websocket bus client (cookie → `/chat/bus_channel` → `/websocket`) |
| `services/callEngine.js` | WebRTC lifecycle, ported from the web client |
| `services/chat.js` | the six `/chat/call/*` signalling wrappers |
| `screens/CallScreen.js` | incoming / in-call overlay, mounted in `App.js` |
| `ChatThreadScreen` header | voice + video buttons, gated like the web `canCall()` |

**This needs a NEW BUILD to run at all** — `react-native-webrtc` is native code (libwebrtc), so
the existing APK cannot execute any of it. The APK at `C:\Projects\Alphalize APK's\369Chats\`
predates this work: verified as `com.alphalize.chats369` with 64 native libs and **zero** WebRTC
ones. That same APK also crashes on launch (gotcha 10), so the next build carries both the
`expo-asset` fix and calling. Confirm before building that autolinking picks up the native modules:

```bash
npx expo-modules-autolinking resolve -p android --json            # expo-asset must be 12.0.13
npx expo-modules-autolinking react-native-config -p android --json # webrtc + cookies must be LINKED
```
(Community modules like `react-native-webrtc` do **not** appear in the first command — that lists
Expo modules only. Checking the wrong one makes them look missing when they are fine.)

Two things remain outside the code:

1. **A TURN server** — `_ice_servers()` returns Google STUN only; `chats_369.turn_url` /
   `turn_user` / `turn_cred` are unset and there is **no admin UI for them** (Google Meet has one,
   calls have nothing). Calls will work on one wifi and **fail on mobile data** until this exists.
   Expect that failure; it is not a bug in the port.
2. **Device verification.** Nothing below has been seen working on hardware.

**Verify in this order — each step is worthless if the previous one failed:**

1. **The bus, before any call.** Log in, send a message from the web client, and confirm it appears
   in the app instantly rather than on the next 3s poll. If it does not, the cookie handshake failed
   and no call can ring. `adb logcat` and look for the `Bus` logger — it warns explicitly on
   `no session_id cookie`.
2. **App ↔ web on one wifi.** The web client is the known-good peer, so a failure here is the app's.
3. **App ↔ app**, then across networks (expect failure until TURN).

Known gaps, deliberate: no speaker/earpiece toggle (needs another native module, and the test
tablet has no earpiece anyway); the incoming push is an ordinary Expo banner, not a VoIP push, so
it **cannot wake a killed app into a ringing UI** — ringing works while the app is running.
iOS additionally needs PushKit/CallKit, which is absent.

## App identity — renamed off kra-kpi

The app no longer carries its old KRA/KPI identity. Current values, all in `app.json`:

| | |
|---|---|
| `slug` | `369chats` (was `kra-kpi-app`) |
| `android.package` | `com.alphalize.chats369` (was `com.alphalize.krakpi`) |
| `ios.bundleIdentifier` | `com.alphalize.chats369` |
| `extra.eas.projectId`, `owner` | **removed** — see below |

**The package is `chats369`, not `369chats`.** An Android package segment is a Java identifier and
may not start with a digit. The *slug* can, and does.

Three consequences worth knowing before you touch this again:

* **The old dev client can no longer be QR-scanned into.** With no explicit `scheme`, the deep link
  is `exp+<slug>`, which just changed. A fresh build is required — this is expected, not a break.
* **`google-services.json` needs a client for the new package** or the build dies with "No matching
  client found for package name". The committed file now has **both** `com.alphalize.chats369` and
  the old `com.alphalize.krakpi`; the Firebase project itself is still called `kra-kpi-3efd5` and
  must not be renamed.
* **`kra_kpi_module` was NOT renamed** and must not be — it is a real Odoo module that `chats_369`
  depends on (`__manifest__.py` line 13), as does `app_user_manual_369`. Every surviving `kra_kpi`
  string in the repo is either that module, one of its `/kra_kpi/*` HTTP routes, or the Firebase
  project id. All three are correct as-is.

## Build environment — current state

**EAS is no longer blocked.** It used to be: `app.json` carried `owner: jicol` and a `projectId`
registered under the old `kra-kpi-app` slug, while the machine was logged in as `vacihe`. Both keys
have now been **deleted** from `app.json` (a `//eas` comment records the dead projectId), so
`npx eas login && npx eas init` under an account you control mints a fresh project cleanly.
`eas.json` already has a `development` profile (`developmentClient: true`, `buildType: apk`).

**After `eas init`, re-upload the FCM V1 service-account key with `eas credentials`** — that key is
stored *per EAS project*, so a fresh project starts with no push credentials and notifications will
silently not arrive. See `FIREBASE_PUSH_SETUP.md`.

A cloud build also sidesteps the RAM ceiling below entirely, which is why it is the recommended
route despite the local toolchain being fully installed.

**Local build setup, done:** SDK at `C:\Users\sriba\AppData\Local\Android\Sdk` with
`platforms/android-36`, build-tools 36/37, cmdline-tools, NDK 27.1. `ANDROID_HOME` +
`ANDROID_SDK_ROOT` set. Device: Samsung SM-T510, Android 11, authorised.

**Two environment fixes that will be needed again:**

* **node is invisible to Gradle.** PATH points at `C:\Program Files\nodejs-nvm\nodejs`, a *directory
  symlink* with a space in it. Groovy's `.execute()` in `android/app/build.gradle` line 13 returns an
  empty string → `Cannot invoke method getAbsoluteFile() on null object`. Fix: prepend the real path
  before building —
  `export PATH="/c/Users/sriba/AppData/Local/nvm/v22.16.0:$PATH"`.
* **RAM is the real constraint.** 8 GB installed, **5.9 GB usable**, often <1 GB free. The default
  `-Xmx2048m` + `org.gradle.parallel=true` gets the daemon killed ("Gradle build daemon disappeared
  unexpectedly"). `C:\Users\sriba\.gradle\gradle.properties` now sets `parallel=false`,
  `workers.max=1`, `kotlin.compiler.execution.strategy=in-process`. It lives in GRADLE_USER_HOME
  because `android/` is regenerated by prebuild and gitignored. Chrome/VS Code must be closed for a
  build to have room.

  It has now taken down **two** different toolchains, so treat "close Chrome first" as a real step,
  not advice: the Gradle daemon *and* `hermesc.exe`, which died with `0xE06D7363` (a C++ exception,
  i.e. a failed allocation, not a source error) during `npx expo export` at ~0.3 GB free. A hermesc
  crash therefore says nothing about your code — free memory and re-run before debugging it.

Build command:
```bash
export ANDROID_HOME="C:\\Users\\sriba\\AppData\\Local\\Android\\Sdk"
export PATH="/c/Users/sriba/AppData/Local/nvm/v22.16.0:$PATH"
npx expo run:android --no-install --no-bundler
```
`/android` and `/ios` are gitignored (lines 40-41) — the native folder is a build artefact.

### Where the local build currently stops — notifee

```
Could not find any matches for app.notifee:core:+
Required by: project :app > project :notifee_react-native
```

**Diagnosed, not fixed.** `@notifee/react-native` 9.1.8 ships its Android artifact as a *local Maven
repo* inside node_modules —
`node_modules/@notifee/react-native/android/libs/app/notifee/core/202108261754/core-202108261754.aar`
— and registers it from its own `android/build.gradle` (~line 112) with:

```groovy
rootProject.allprojects { repositories { maven { url "$notifeeDir/android/libs" } } }
```

Expo's CLI invokes Gradle with **`--configure-on-demand`**, so `:app` resolves
`debugRuntimeClasspath` *before* `:notifee_react-native` is configured and can inject that
repository. The error's search list confirms it: google, mavenCentral, jitpack and sonatype — never
notifee's own folder. There is no `dependencyResolutionManagement` block, so this is ordering, not
a repositories-mode restriction.

Two likely fixes, neither tried:
1. Add the repo to the generated `android/build.gradle` `allprojects` block (line 16) — but `android/`
   is regenerated by prebuild, so this belongs in an `expo-build-properties` config or a config
   plugin to survive.
2. Build without `--configure-on-demand` (run `./gradlew app:assembleDebug` directly rather than via
   `expo run:android`).

Everything before this point succeeded: SDK resolution, Kotlin compile, NDK 27.1 install, and all
~19 native modules configuring. Only dependency resolution for `:app` failed.

---

## Remaining parity gaps (app vs web)

**Small — the service call already exists, only UI is missing:** nickname set (`setNickname` has 0
callers), group photo (`updateGroup(...,'photo')` no caller), invite reset/revoke, favourite star on
the row, pin "N days left", jump-to-date in search (`searchMessages` takes `date`, nothing passes it).

**Composer:** @mention autocomplete incl. `@all` (the server already sends mention pushes), emoji
insert at caret (currently appends), `*bold* _italic_ ~strike~ \`mono\``, sentence-casing.

**Larger:** multi-select + bulk star/forward/delete, rich media viewer (prev/next, zoom, filmstrip,
download), Media + Profile tabs in `BottomTabs` (which is also what makes the all-chats media screen
reachable — `App.js` always passes `activeChat`), admin `admin_all` monitor mode, in-thread block bar.

## Known defects, documented not fixed

* `chat_poll.py` uses legacy `_sql_constraints`, **silently ignored in Odoo 19** — the unique index on
  `(option_id, user_id)` may never have been created, so double-voting may be possible. Converting it
  to `models.Constraint` makes the upgrade **fail if duplicates already exist** — count first.
* Call history is fully client-asserted: `/chat/call/end` writes `duration`/`missed`/`video` verbatim
  because the server holds no call state. Fixing it properly is a design change.
* Web dead code: `openPrivacy` / `setPrivacy` / the Privacy modal have no entry point.

## Blocked on you

* **EAS account** — `app.json` is now clean of the old `jicol`/`kra-kpi-app` project, so this is
  just `npx eas login && npx eas init` under an account you control, then `eas credentials` to
  re-upload the FCM V1 key.
* **TURN server** (coturn) + the three config params, and ideally an admin panel for them.
* **Device verification** — nothing in this session has been confirmed on a screen by me.
