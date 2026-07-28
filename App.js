// App shell: Splash → Welcome → Odoo device setup (Connect) → the chat list.
// A remembered session boots straight to the chat list after the splash.
//
// Navigation is a hand-rolled state machine, not a navigator: `appScreen` holds
// the current post-login route and renderScreen() maps it to a component. The
// root is 'chats' — the app opens on the conversation list the way WhatsApp does,
// with no dashboard in front of it. Adding a screen is an import, a branch below,
// and an entry in the chat list's ⋮ menu.
import React, { useState, useEffect, useRef } from 'react';
import { BackHandler, AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import SplashScreen from './screens/SplashScreen';
import LoginScreen from './screens/LoginScreen';
import ConnectScreen from './screens/ConnectScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import ConfigurationScreen from './screens/ConfigurationScreen';
import LoginManagementScreen from './screens/LoginManagementScreen';
import UsersScreen from './screens/UsersScreen';
import CompanyBranding from './screens/CompanyBranding';
import UserManual from './screens/UserManual';
import ChatListScreen from './screens/ChatListScreen';
import ChatThreadScreen from './screens/ChatThreadScreen';
import NewChatScreen from './screens/NewChatScreen';
import ContactInfoScreen from './screens/ContactInfoScreen';
import ChatSearchScreen from './screens/ChatSearchScreen';
import ChatMediaScreen from './screens/ChatMediaScreen';
import StarredScreen from './screens/StarredScreen';
import GroupManageScreen from './screens/GroupManageScreen';
import ChatSettingsScreen from './screens/ChatSettingsScreen';
import AppLoginScreen from './screens/AppLoginScreen';
import AlarmScreen from './screens/AlarmScreen';
import ScreenTransition from './components/ScreenTransition';
import { scheduleTaskAlarm, stopAlarm } from './services/alarm';

// notifee is a native module, present only after the one-time rebuild. Load it
// DEFENSIVELY — a static import would throw at launch in a build without the native
// side and crash the app. Until it's available the alarm event wiring below no-ops;
// the app runs normally and the notification reminder still works.
let notifee = null, EventType = {};
try {
  const nf = require('@notifee/react-native');
  notifee = nf.default;
  EventType = nf.EventType;
} catch (_) { /* notifee native module absent (pre-rebuild) — alarm inert */ }
import * as session from './api/session';
import { createLogger } from './api/logger';
import { registerForPushAsync, unregisterPush } from './services/push';
import realtime from './services/chatRealtime';

const log = createLogger('App');

// Mobile-number sign-in (AppLoginScreen + services/appAuth, the /kpi_app/* routes).
// HIDDEN, NOT DELETED — both files are intact and this flag is the only thing
// standing between them and the login flow. Flip to true to bring it back.
//
// While it is off, the Odoo login in ConnectScreen doubles as the app login: it
// provisions the device AND starts the session from the account that just
// authenticated. Turning it back on makes ConnectScreen pure device-setup again
// and the number screen becomes the way in, exactly as it was.
const NUMBER_LOGIN_ENABLED = false;

// Definitive runtime check: 'storeClient' = Expo Go (local notifications DON'T
// display there); 'standalone'/'bare' = a real dev/standalone build (they do).
log.info('runtime env', {
  executionEnvironment: Constants.executionEnvironment,
  appOwnership: Constants.appOwnership,
  isExpoGo: Constants.executionEnvironment === 'storeClient',
});

// Show a banner + add to the tray even when the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // Diagnostic: proves a (local or push) notification actually FIRED while the
    // app is foregrounded — the reminder alarm should log here when its timer hits.
    log.info('notification received (foreground)', {
      title: notification?.request?.content?.title,
      data: notification?.request?.content?.data,
    });
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
  },
});

// SafeAreaProvider supplies the real system-bar insets — every chat screen pads
// by insets.bottom so edge-to-edge doesn't draw content under the nav/gesture bar.
export default function App() {
  return (
    <SafeAreaProvider>
      {/* One app-wide status bar: dark icons on the transparent (edge-to-edge)
          bar, so every screen's light background shows through — no black strip. */}
      <StatusBar style="dark" />
      <AppInner />
    </SafeAreaProvider>
  );
}

function AppInner() {
  const [ready, setReady] = useState(false);       // splash finished
  const [restoring, setRestoring] = useState(true); // reading saved session
  const [screen, setScreen] = useState('login');    // login (welcome) | connect
  const [user, setUser] = useState(null);
  // Post-login route. 'chats' is the root, the way WhatsApp opens on the
  // conversation list — there is no dashboard in front of it.
  const [appScreen, setAppScreen] = useState('chats');
  // Id a notification tap wants the destination screen to focus/flash. One slot:
  // only one screen is open at a time, and it clears on the way back to the root
  // so a stale id can't make an unrelated row flash on the next visit. Nothing
  // consumes it yet — open() threads it through, ready for the first screen that wants it.
  const [focusId, setFocusId] = useState(null);
  // Set when a task ALARM fires (services/alarm.js full-screen intent). Holds
  // { task, notifId }; while non-null the ringing AlarmScreen takes over the whole
  // app (even before login) so Stop is always reachable to silence it.
  const [alarmData, setAlarmData] = useState(null);
  // The conversation ChatThreadScreen is showing. Held here rather than in the
  // list screen so a notification tap can open a thread directly.
  const [activeChat, setActiveChat] = useState(null);
  const [provisioned, setProvisioned] = useState(false); // device set up (server URL saved)
  const [forceSetup, setForceSetup] = useState(false);   // show Odoo device-setup over the app login

  const pushTokenRef = useRef(null);       // this device's Expo token (for logout unregister)
  const pendingTapRef = useRef(null);      // a tap that arrived before login/restore

  // Keep a ref to `user` so listeners (registered once) see the latest value.
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  // Route a notification tap to a screen, focusing the record it names.
  //
  // A cold-start tap can land before the session is restored, so it queues in a
  // ref and flushes once `user` exists. When chat lands, this is the seam: read
  // `data.chat_id` and route to the thread screen alongside whatever else ships.
  const routeToNotification = (data) => {
    if (!data) return;
    const dest = 'notifications';
    const id = data.id ?? null;
    if (userRef.current) {
      setFocusId(id);
      setAppScreen(dest);
    } else {
      pendingTapRef.current = data;
    }
  };

  // A task alarm (notifee) carries data.alarm==='1' + kpi_id + task_name and the
  // notification id. Show the full-screen ringing screen so the user can Stop it.
  const routeToAlarm = (notif) => {
    const data = notif?.data || {};
    if (String(data.alarm) !== '1') return;
    log.info('alarm → full-screen', { notifId: notif?.id });
    // `reason` = the optional note typed when setting the reminder (shown on the
    // alarm screen; blank → plain screen).
    setAlarmData({ task: { id: data.kpi_id, name: data.task_name || '' }, reason: data.reason || '', notifId: notif?.id });
  };

  // STOP: cancel the notification (stops the loop) and clear the stored reminder
  // so the card bell resets. Then drop the takeover.
  const stopAlarmAndClose = async () => {
    const a = alarmData;
    log.info('alarm: stop pressed', { notifId: a?.notifId, taskId: a?.task?.id });
    setAlarmData(null);
    if (a?.notifId) await stopAlarm(a.notifId);
    if (a?.task?.id) {
      try { await session.removeReminder(a.task.id); } catch (_) {}
    }
  };

  // SNOOZE: stop the current ring and re-schedule the same alarm, updating the
  // stored reminder so the card bell shows the new time.
  const snoozeAlarm = async () => {
    const a = alarmData;
    log.info('alarm: snooze pressed', { notifId: a?.notifId, taskId: a?.task?.id });
    setAlarmData(null);
    if (a?.notifId) await stopAlarm(a.notifId);
    if (a?.task) {
      // Snooze length comes from the user's alarm settings (set in the picker).
      const { snoozeMins } = await session.getAlarmSettings();
      const mins = Math.max(1, snoozeMins || 5);
      const whenMs = Date.now() + mins * 60 * 1000;
      const reason = a.reason || '';
      const notifId = await scheduleTaskAlarm(a.task, whenMs, reason);
      log.info('alarm: snoozed', { taskId: a.task.id, notifId, whenMs, snoozeMins: mins });
      try {
        await session.setReminder(a.task.id, {
          whenIso: new Date(whenMs).toISOString(), notifId, mode: 'alarm', reason,
          snoozed: true,   // so the task shows a "Snoozed" state, not a plain reminder
        });
      } catch (_) {}
    }
  };

  // Restore a remembered session + device-setup state on relaunch.
  useEffect(() => {
    (async () => {
      const conn = await session.getConnection();
      setProvisioned(!!(conn && conn.serverUrl));   // device already set up?
      const saved = await session.getSession();
      if (saved) setUser(saved);
      setRestoring(false);
    })();
  }, []);

  // Android hardware back: go one screen back instead of exiting the app.
  // Returning true from the handler tells Android we handled the event.
  useEffect(() => {
    const onBack = () => {
      // The chat screens are a stack, so hardware back must walk it rather than
      // jumping to the root — otherwise leaving a thread exits the whole chat area.
      if (user && appScreen === 'groupmanage') { setAppScreen('chatinfo'); return true; }
      if (user && appScreen === 'chatinfo') { setAppScreen('chat'); return true; }
      if (user && ['chatsearch', 'chatmedia', 'starred'].includes(appScreen)) {
        setAppScreen(activeChat ? 'chat' : 'chats'); return true;
      }
      if (user && appScreen === 'chatsettings') { setAppScreen('chats'); return true; }
      if (user && appScreen === 'chat') { setActiveChat(null); setAppScreen('chats'); return true; }
      if (user && appScreen === 'newchat') { setAppScreen('chats'); return true; }
      // Everything else (notifications, admin screens) returns to the chat list,
      // which is now the root. Falling through on 'chats' itself is what lets
      // Android close the app — returning true there would trap the user.
      if (user && appScreen !== 'chats') { setAppScreen('chats'); return true; }
      // Odoo sheet open → close it, revealing the welcome ("Tap to Enter") screen.
      if (!user && screen === 'connect') { setScreen('login'); return true; }
      // On the welcome screen during admin setup → back to the mobile login page.
      if (!user && forceSetup) { setForceSetup(false); return true; }
      return false; // at the chat list / login — let the OS handle it (exit)
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [user, appScreen, screen, forceSetup, activeChat]);

  // Register this device for push once logged in (needs the session cookie so
  // the token binds to the right user server-side).
  useEffect(() => {
    if (!user) return;
    (async () => {
      const token = await registerForPushAsync();
      if (token) pushTokenRef.current = token;
    })();
  }, [user?.uid]);

  // Flush a queued cold-start tap once the session exists.
  useEffect(() => {
    if (!user || !pendingTapRef.current) return;
    const data = pendingTapRef.current;
    pendingTapRef.current = null;
    log.info('cold-start tap flushed', data);
    routeToNotification(data);
  }, [user?.uid]);

  // Notification tap → open the screen it points at. Registered once; reads the
  // latest user via userRef. Also handles a cold-start tap (app launched from
  // a killed state by tapping the banner).
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const data = resp?.notification?.request?.content?.data || {};
      log.info('notification tapped', data);
      routeToNotification(data);
    });
    (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        const data = last?.notification?.request?.content?.data;
        if (data) { log.info('cold-start notification tap', data); routeToNotification(data); }
      } catch (_) {}
    })();
    return () => sub.remove();
  }, []);

  // Notifee (task alarm) events. onForegroundEvent covers the app-open cases: the
  // alarm fired while the app is up (DELIVERED) or the user tapped it (PRESS).
  // getInitialNotification covers the cold-start / lock-screen case where the
  // full-screen intent LAUNCHED the app. Both funnel through routeToAlarm, which
  // shows the full-screen Stop UI. Registered once.
  useEffect(() => {
    if (!notifee) return;   // native module absent (pre-rebuild) — no alarm events
    const unsub = notifee.onForegroundEvent(({ type, detail }) => {
      const notif = detail?.notification;
      if (!notif || String(notif?.data?.alarm) !== '1') return;
      if (type === EventType.DELIVERED || type === EventType.PRESS) {
        log.info('alarm foreground event', { type, notifId: notif.id });
        routeToAlarm(notif);
      }
    });
    (async () => {
      try {
        const initial = await notifee.getInitialNotification();
        if (String(initial?.notification?.data?.alarm) === '1') {
          log.info('cold-start alarm', { notifId: initial.notification.id });
          routeToAlarm(initial.notification);
        }
      } catch (_) {}
    })();
    return () => unsub();
  }, []);

  // Warm lock-screen wake: when the full-screen intent brings a BACKGROUNDED (not
  // killed) app forward, getInitialNotification won't fire — so on every resume,
  // check the displayed notifications for a live alarm and show the Stop screen.
  useEffect(() => {
    if (!notifee) return;
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      try {
        const displayed = await notifee.getDisplayedNotifications();
        const hit = (displayed || []).find((d) => String(d?.notification?.data?.alarm) === '1');
        if (hit) { log.info('alarm resume-check → full-screen', { notifId: hit.notification?.id }); routeToAlarm(hit.notification); }
      } catch (_) {}
    });
    return () => sub.remove();
  }, []);

  const logout = async () => {
    // Best-effort: stop this device receiving the previous user's banners.
    if (pushTokenRef.current) { unregisterPush(pushTokenRef.current); pushTokenRef.current = null; }
    // Stop the chat polling loops before the session goes — otherwise they keep
    // firing requests that now 401 and log noise all the way to the login screen.
    realtime.stop();
    await session.clearSession();
    setUser(null);
    setScreen('login');
    setAppScreen('chats');
    setActiveChat(null);
    setFocusId(null);
  };

  // Splash keeps showing until both the animation and the session read finish.
  if (!ready || restoring) return <SplashScreen onDone={() => setReady(true)} />;

  // A ringing task alarm takes over EVERYTHING (even before login) so Stop is
  // always reachable to silence it. Wins over the chat list and login.
  if (alarmData) {
    return <AlarmScreen alarm={alarmData} onStop={stopAlarmAndClose} onSnooze={snoozeAlarm} />;
  }

  if (user) {
    log.info('render post-login screen', { appScreen });
    // Back to the root (the chat list), clearing any pending focus so it can't
    // re-flash later.
    const home = () => { setAppScreen('chats'); setFocusId(null); };
    // open(dest, param): param is an optional record id for the destination to
    // focus and flash.
    const open = (dest, param) => {
      log.info('open', dest, param);
      setFocusId(param ?? null);
      setAppScreen(dest);
    };

    // Every post-login screen renders through renderScreen() so ScreenTransition
    // plays the same open animation for all of them.
    const renderScreen = () => {
      if (appScreen === 'chat' && activeChat)
        return (
          <ChatThreadScreen
            conversation={activeChat}
            // Back goes to the list, not Home — the list is where they came from.
            onBack={() => { setActiveChat(null); setAppScreen('chats'); }}
            onOpenInfo={() => setAppScreen('chatinfo')}
            onOpenSearch={() => setAppScreen('chatsearch')}
            onOpenMedia={() => setAppScreen('chatmedia')}
            onOpenStarred={() => setAppScreen('starred')}
          />
        );
      if (appScreen === 'chatinfo' && activeChat)
        return (
          <ContactInfoScreen
            conversation={activeChat}
            onBack={() => setAppScreen('chat')}
            onManageGroup={() => setAppScreen('groupmanage')}
            // Messaging a group member switches the open thread to that 1:1.
            onOpenChat={(conv) => { setActiveChat(conv); setAppScreen('chat'); }}
            // Left/deleted → the thread is gone, so return to the list.
            onLeft={() => { setActiveChat(null); setAppScreen('chats'); }}
          />
        );
      if (appScreen === 'groupmanage' && activeChat)
        return (
          <GroupManageScreen
            conversation={activeChat}
            onBack={() => setAppScreen('chatinfo')}
            // Renaming/adding changes the header the thread shows, so refresh it.
            onChanged={() => setActiveChat((c) => ({ ...c }))}
          />
        );
      if (appScreen === 'chatsearch')
        return (
          <ChatSearchScreen
            // activeChat set → scoped to that thread; null → global search.
            conversation={activeChat}
            onBack={() => setAppScreen(activeChat ? 'chat' : 'chats')}
            onJump={() => setAppScreen('chat')}
            onOpenChat={() => setAppScreen('chats')}
          />
        );
      if (appScreen === 'chatmedia')
        return <ChatMediaScreen conversation={activeChat} onBack={() => setAppScreen(activeChat ? 'chat' : 'chats')} />;
      if (appScreen === 'starred')
        return <StarredScreen onBack={() => setAppScreen(activeChat ? 'chat' : 'chats')} onOpenChat={() => setAppScreen('chats')} />;
      if (appScreen === 'chatsettings')
        return (
          <ChatSettingsScreen
            user={user}
            onBack={() => setAppScreen('chats')}
            onLogout={logout}
          />
        );
      if (appScreen === 'newchat')
        return (
          <NewChatScreen
            onBack={() => setAppScreen('chats')}
            // openDirect/createGroup both return a conversation, so go straight in.
            onOpenChat={(conv) => { setActiveChat(conv); setAppScreen('chat'); }}
          />
        );
      if (appScreen === 'notifications')
        return <NotificationsScreen onBack={home} onOpen={open} />;
      if (appScreen === 'config')
        return <ConfigurationScreen onBack={home} />;
      if (appScreen === 'loginmgmt')
        return <LoginManagementScreen onBack={home} />;
      if (appScreen === 'users')
        return <UsersScreen onBack={home} />;
      if (appScreen === 'companybranding')
        return <CompanyBranding onBack={home} />;
      if (appScreen === 'usermanual')
        return <UserManual onBack={home} />;
      // Fallthrough IS the root. Any unmatched route — including 'chat' and
      // friends when activeChat is somehow null — lands on the chat list rather
      // than a blank screen.
      return (
        <ChatListScreen
          onBack={home}
          onNewChat={() => setAppScreen('newchat')}
          onOpenChat={(conv) => { setActiveChat(conv); setAppScreen('chat'); }}
          onOpenSearch={() => { setActiveChat(null); setAppScreen('chatsearch'); }}
          onOpenStarred={() => setAppScreen('starred')}
          onOpenSettings={() => setAppScreen('chatsettings')}
          onOpenNotifications={() => setAppScreen('notifications')}
          onOpenAdmin={(dest) => setAppScreen(dest)}
          onLogout={logout}
        />
      );
    };

    // key by appScreen so each navigation replays the enter animation.
    return (
      <ScreenTransition screenKey={appScreen}>
        {renderScreen()}
      </ScreenTransition>
    );
  }

  // Not logged in. With the number login ON, a provisioned device goes straight
  // to the mobile# + password page, and the Odoo login stays reachable behind
  // "Admin / device setup" so no one is locked out. With it OFF this branch is
  // skipped entirely and everyone lands on the welcome + Odoo sheet below.
  if (NUMBER_LOGIN_ENABLED && provisioned && !forceSetup) {
    return (
      <AppLoginScreen
        onLogin={(u) => { setForceSetup(false); setUser(u); }}
        onNeedSetup={() => { setForceSetup(true); setScreen('connect'); }}
      />
    );
  }

  // Welcome + the Connect (URL/DB/Odoo login) sheet. ConnectScreen always saves
  // the server/DB; whether that also signs you in depends on the flag.
  const onConnected = async (profile) => {
    setProvisioned(true);
    setForceSetup(false);
    setScreen('login');
    // Number login off → the Odoo account that just authenticated IS the user.
    // Persist it so a relaunch restores the session instead of asking again.
    if (!NUMBER_LOGIN_ENABLED && profile) {
      log.info('odoo login → session', { uid: profile.uid, login: profile.username });
      try { await session.saveSession(profile); } catch (e) { log.warn('saveSession failed', e?.message); }
      setUser(profile);
    }
  };

  return (
    <>
      <LoginScreen goConnect={() => setScreen('connect')} />
      <ConnectScreen
        visible={screen === 'connect'}
        onLogin={onConnected}
        goBack={() => setScreen('login')}
      />
    </>
  );
}
