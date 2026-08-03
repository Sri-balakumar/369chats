// App shell: Splash → Welcome → Odoo device setup (Connect) → the chat list.
// A remembered session boots straight to the chat list after the splash.
//
// Navigation is a hand-rolled state machine, not a navigator: `appScreen` holds
// the current post-login route and renderScreen() maps it to a component. The
// root is 'chats' — the app opens on the conversation list the way WhatsApp does,
// with no dashboard in front of it. Adding a screen is an import, a branch below,
// and an entry in the chat list's ⋮ menu.
import React, { useState, useEffect, useRef } from 'react';
import { BackHandler, AppState, View } from 'react-native';
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
import CallsScreen from './screens/CallsScreen';
import CallScreen from './screens/CallScreen';
import BottomTabs from './components/chat/BottomTabs';
import SwipeTabs from './components/chat/SwipeTabs';
import { runBackIntercepts } from './hooks/useBackIntercept';
import ChatSearchScreen from './screens/ChatSearchScreen';
import ChatMediaScreen from './screens/ChatMediaScreen';
import StarredScreen from './screens/StarredScreen';
import GroupManageScreen from './screens/GroupManageScreen';
import ChatSettingsScreen from './screens/ChatSettingsScreen';
import GmeetSettingsScreen from './screens/GmeetSettingsScreen';
import AppLoginScreen from './screens/AppLoginScreen';
import AlarmScreen from './screens/AlarmScreen';
import DebugLogScreen from './screens/DebugLogScreen';
import ScreenTransition from './components/ScreenTransition';
import { ThemeProvider, useTheme } from './theme';
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
import { createLogger, loadLoggingPref } from './api/logger';
import { registerForPushAsync, unregisterPush } from './services/push';
import realtime from './services/chatRealtime';
import callEngine from './services/callEngine';
import { loadDrafts } from './services/drafts';

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
      <ThemeProvider>
        <Chrome />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Chrome() {
  return (
    <>
      {/* One app-wide status bar over the transparent (edge-to-edge) bar, so
          every screen's own background shows through — no black strip. The app
          is light-only, so the icons are always dark. */}
      <StatusBar style="dark" />
      <AppInner />
    </>
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
  // Google Meet settings is reachable from two places; remember which, so back
  // returns where the user came from rather than always to Chat settings.
  const [gmeetFrom, setGmeetFrom] = useState('chatsettings');
  // Same idea for the media gallery: it opens from the thread ⋮ and from contact
  // info, and back must not skip the info screen on the way out.
  const [mediaFrom, setMediaFrom] = useState('chat');
  // A quote carried from a group into a 1:1 by 'Reply privately'. Consumed by the
  // thread on mount, then cleared so revisiting the chat doesn't re-seed it.
  const [pendingQuote, setPendingQuote] = useState(null);
  // Drives the remount key below, so switching accent repaints module-level styles.
  const { key: themeKey } = useTheme();
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
  // Total unread across every chat, for the Chats tab badge. The realtime engine
  // already polls the conversation list, so this piggybacks on that rather than
  // adding a second timer — /chat/unread_total is an N+1 query server-side.
  const [chatUnread, setChatUnread] = useState(0);
  const [provisioned, setProvisioned] = useState(false); // device set up (server URL saved)
  const [forceSetup, setForceSetup] = useState(false);   // show Odoo device-setup over the app login

  const pushTokenRef = useRef(null);       // this device's Expo token (for logout unregister)
  const pendingTapRef = useRef(null);      // a tap that arrived before login/restore

  // Keep a ref to `user` so listeners (registered once) see the latest value.
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  // Warm the draft cache once, so the chat list and composer can read drafts
  // synchronously during render.
  useEffect(() => { loadDrafts(); }, []);

  // Restore whether debug logging was left switched on. Deliberately first and
  // un-awaited by anything else: the failures worth capturing happen during
  // launch, so the flag needs to be live as early as possible.
  useEffect(() => { loadLoggingPref(); }, []);

  // Chats badge: the realtime engine emits the whole conversation list on every
  // poll, so summing unreadCount there costs nothing extra.
  useEffect(() => {
    if (!user) return undefined;
    return realtime.subscribe((event, data) => {
      if (event !== 'conversations') return;
      setChatUnread((data.conversations || []).reduce((n, c) => n + (c.unreadCount || 0), 0));
    });
  }, [user?.uid]);

  // Bind the call engine to the bus as soon as there is a session. It has to live
  // here rather than on a screen: an incoming call must ring wherever the user is,
  // including on screens that know nothing about chat.
  useEffect(() => {
    if (!user) return undefined;
    callEngine.start();
    return () => callEngine.stop();
  }, [user?.uid]);

  // Route a notification tap to a screen, focusing the record it names.
  //
  // A cold-start tap can land before the session is restored, so it queues in a
  // ref and flushes once `user` exists.
  //
  // Chat pushes carry `chat_id` plus event 'chat_message' / 'chat_mention'
  // (chat_api.py _push_chat / _notify_mentions). Those must open the THREAD —
  // every tap used to land on the KPI notification feed regardless, so tapping a
  // message notification never took you to the message.
  const routeToNotification = (data) => {
    if (!data) return;
    if (!userRef.current) { pendingTapRef.current = data; return; }

    const chatId = Number(data.chat_id || 0);
    // 'chat_call' still routes to the THREAD, not to the call UI, and that is
    // deliberate. The ring itself arrives over the bus and CallScreen puts itself
    // on top the moment it does — the push is only a banner (see _push_call in
    // chat_api.py: it is an ordinary Expo alert, not a VoIP push, so it cannot
    // wake a killed app into a ringing state). By the time a tap is processed the
    // call is either already ringing on screen or long gone, and the chat is the
    // one destination that is useful in both cases.
    if (chatId && (data.event === 'chat_call' || data.event === 'chat_message'
      || data.event === 'chat_mention' || !data.event)) {
      // Title is unknown here; the thread fetches the real conversation on mount.
      setActiveChat({ id: chatId, title: data.title || 'Chat' });
      setFocusId(null);
      setAppScreen('chat');
      return;
    }
    setFocusId(data.id ?? null);
    setAppScreen('notifications');
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
      // Anything that is NOT a route gets first refusal: the archive, a message
      // selection, an in-tree overlay like ConfirmDialog. Without this, back
      // from the archive found no route to pop and closed the app.
      if (runBackIntercepts()) return true;
      // The chat screens are a stack, so hardware back must walk it rather than
      // jumping to the root — otherwise leaving a thread exits the whole chat area.
      if (user && appScreen === 'groupmanage') { setAppScreen('chatinfo'); return true; }
      if (user && appScreen === 'chatinfo') { setAppScreen('chat'); return true; }
      if (user && appScreen === 'chatmedia') {
        setAppScreen(activeChat ? (mediaFrom || 'chat') : 'chats'); return true;
      }
      if (user && ['chatsearch', 'starred'].includes(appScreen)) {
        setAppScreen(activeChat ? 'chat' : 'chats'); return true;
      }
      if (user && appScreen === 'chatsettings') { setAppScreen('chats'); return true; }
      if (user && appScreen === 'gmeetsettings') { setAppScreen(gmeetFrom || 'chatsettings'); return true; }
      // Without this the generic fallthrough below would drop to the chat list,
      // losing the settings screen it was opened from.
      if (user && appScreen === 'debuglog') { setAppScreen('chatsettings'); return true; }
      // Calls is a root tab: back goes to Chats, the primary root.
      if (user && appScreen === 'calls') { setAppScreen('chats'); return true; }
      if (user && appScreen === 'chat') { setActiveChat(null); setFocusId(null); setAppScreen('chats'); return true; }
      if (user && (appScreen === 'newchat' || appScreen === 'newgroup')) { setAppScreen('chats'); return true; }
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
  }, [user, appScreen, screen, forceSetup, activeChat, gmeetFrom, mediaFrom]);

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
    callEngine.stop();
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
            // Only set when arriving from a search hit; cleared on the way out so
            // a stale id can't re-jump the next time this chat is opened.
            focusMessageId={focusId}
            // Back goes to the list, not Home — the list is where they came from.
            onBack={() => { setActiveChat(null); setFocusId(null); setPendingQuote(null); setAppScreen('chats'); }}
            onOpenInfo={() => setAppScreen('chatinfo')}
            onOpenSearch={() => setAppScreen('chatsearch')}
            onOpenMedia={() => { setMediaFrom('chat'); setAppScreen('chatmedia'); }}
            onOpenStarred={() => setAppScreen('starred')}
            onOpenGmeet={() => { setGmeetFrom('chat'); setAppScreen('gmeetsettings'); }}
            initialQuote={pendingQuote}
            onReplyPrivately={(conv, quote) => {
              setActiveChat(conv);
              setPendingQuote(quote);
              setAppScreen('chat');
            }}
          />
        );
      if (appScreen === 'chatinfo' && activeChat)
        return (
          <ContactInfoScreen
            conversation={activeChat}
            onBack={() => setAppScreen('chat')}
            onManageGroup={() => setAppScreen('groupmanage')}
            // Media opens the same gallery the thread ⋮ uses; mediaFrom sends back
            // here rather than past this screen to the thread.
            onOpenMedia={() => { setMediaFrom('chatinfo'); setAppScreen('chatmedia'); }}
            // Messaging a group member switches the open thread to that 1:1.
            onOpenChat={(conv) => { setActiveChat(conv); setFocusId(null); setAppScreen('chat'); }}
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
        return (
          <ChatMediaScreen
            conversation={activeChat}
            onBack={() => setAppScreen(activeChat ? (mediaFrom || 'chat') : 'chats')}
          />
        );
      if (appScreen === 'starred')
        return <StarredScreen onBack={() => setAppScreen(activeChat ? 'chat' : 'chats')} onOpenChat={() => setAppScreen('chats')} />;
      if (appScreen === 'chatsettings')
        return (
          <ChatSettingsScreen
            user={user}
            onBack={() => setAppScreen('chats')}
            onOpenGmeet={() => { setGmeetFrom('chatsettings'); setAppScreen('gmeetsettings'); }}
            onOpenDebugLog={() => setAppScreen('debuglog')}
            onLogout={logout}
          />
        );
      // Admin-only config for the shared Google account. Reachable from Chat
      // settings and from a thread's ⋮ when Meet is not connected yet.
      if (appScreen === 'gmeetsettings')
        return <GmeetSettingsScreen onBack={() => setAppScreen(gmeetFrom || 'chatsettings')} />;
      if (appScreen === 'debuglog')
        return <DebugLogScreen onBack={() => setAppScreen('chatsettings')} />;
      if (appScreen === 'newchat' || appScreen === 'newgroup')
        return (
          <NewChatScreen
            // Reached either from the + (contacts first) or from the ⋮ "New
            // group", which drops straight into the group builder.
            startInGroupMode={appScreen === 'newgroup'}
            onBack={() => setAppScreen('chats')}
            // openDirect/createGroup both return a conversation, so go straight in.
            onOpenChat={(conv) => { setActiveChat(conv); setFocusId(null); setAppScreen('chat'); }}
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
      if (appScreen === 'calls')
        return (
          <CallsScreen
            onOpenChat={(conversationId, title) => {
              setActiveChat({ id: conversationId, title: title || 'Chat' });
              setAppScreen('chat');
            }}
          />
        );
      // Fallthrough IS the root. Any unmatched route — including 'chat' and
      // friends when activeChat is somehow null — lands on the chat list rather
      // than a blank screen.
      return (
        <ChatListScreen
          onBack={home}
          onNewChat={(opts) => setAppScreen(opts?.group ? 'newgroup' : 'newchat')}
          onOpenChat={(conv) => { setActiveChat(conv); setFocusId(null); setAppScreen('chat'); }}
          onOpenSearch={() => { setActiveChat(null); setAppScreen('chatsearch'); }}
          onOpenStarred={() => setAppScreen('starred')}
          onOpenSettings={() => setAppScreen('chatsettings')}
          onOpenNotifications={() => setAppScreen('notifications')}
          onOpenAdmin={(dest) => setAppScreen(dest)}
          // A search hit opens that conversation AT that message: the thread
          // loads the window around it via /chat/messages_around and flashes it.
          onOpenHit={(conversationId, messageId, title) => {
            setActiveChat({ id: conversationId, title: title || 'Chat' });
            setFocusId(messageId ?? null);
            setAppScreen('chat');
          }}
          onLogout={logout}
        />
      );
    };

    // The tab bar belongs to the two ROOT screens only. On a thread or a
    // settings page it would compete with the back button for the same gesture.
    const ROOTS = ['chats', 'calls'];
    const atRoot = ROOTS.includes(appScreen);

    // key by appScreen so each navigation replays the enter animation.
    //
    // themeName is in the key too. Module-level StyleSheet blocks are built once
    // per palette and handed out by a proxy (see theme.js) — a component that
    // never calls useTheme() would keep rendering the old palette's objects, so
    // a flip remounts the tree. It costs one frame on an action taken once, and
    // AppInner's own state (user, appScreen, activeChat) lives above this and
    // survives.
    return (
      <View style={{ flex: 1 }}>
        {/* Swipe Chats ⇄ Calls, on the two root tabs only — anywhere else a
            horizontal swipe would fight the back gesture. This wraps the screen
            AND the tab bar so the gesture works over the pill too, and sits
            outside ScreenTransition so a swipe is never interrupted by the
            enter animation it just triggered. */}
        {atRoot ? (
          <SwipeTabs
            onLeft={() => appScreen === 'chats' && setAppScreen('calls')}
            onRight={() => appScreen === 'calls' && setAppScreen('chats')}
          >
            <ScreenTransition screenKey={`${appScreen}:${themeKey}`}>
              {renderScreen()}
            </ScreenTransition>
            <BottomTabs
              active={appScreen}
              onChange={setAppScreen}
              counts={{ chats: chatUnread }}
            />
          </SwipeTabs>
        ) : (
          <ScreenTransition screenKey={`${appScreen}:${themeKey}`}>
            {renderScreen()}
          </ScreenTransition>
        )}
        {/* Last sibling and outside ScreenTransition: a call covers the whole app
            and must not be unmounted by a navigation. Renders null when idle. */}
        <CallScreen />
      </View>
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
