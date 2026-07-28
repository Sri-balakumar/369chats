// CHATS — the conversation list. The app's main chat surface.
//
// Rows come from /chat/conversations already sorted (pinned first, then last
// activity) and already filtered, so this screen never re-sorts; it just renders.
// The realtime engine pushes a fresh list every few seconds.
import React, { useState, useEffect, useCallback, useRef } from 'react';
// (useRef is used for the list handle and the filter mirror.)
import {
  View, Text, Image, TouchableOpacity, StyleSheet, TextInput, FlatList, RefreshControl, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SHADOW, RADIUS, SPACING, TOP } from '../theme';
import { Screen, ChipRow, Loader, EmptyState, Avatar, PopupModal, MenuPopup, emptyWrap } from '../components/ui';
import * as chat from '../services/chat';
import { fetchUnreadCount } from '../services/notifications';
import realtime from '../services/chatRealtime';
import { createLogger } from '../api/logger';

const log = createLogger('ChatList');

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'favourites', label: 'Favourites' },
  { key: 'groups', label: 'Groups' },
  { key: 'archived', label: 'Archived' },
];

// WhatsApp-style stamp: today → time, yesterday → "Yesterday", this week → day
// name, older → date. The server sends UTC with a literal Z, which the Date
// constructor handles, so this renders in the device's timezone.
function stamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  if (now - d < 7 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// The list preview gets an icon for non-text messages, mirroring the server's own
// _preview() wording ("Photo", "Video", "Voice message", "Document").
function previewIcon(kind) {
  switch (kind) {
    case 'image': return 'image-outline';
    case 'video': return 'videocam-outline';
    case 'audio': return 'mic-outline';
    case 'document': return 'document-outline';
    case 'poll': return 'stats-chart-outline';
    default: return null;
  }
}

function Row({ conv, onPress, onLongPress }) {
  const icon = previewIcon(conv.lastKind);
  return (
    <TouchableOpacity style={s.row} onPress={onPress} onLongPress={onLongPress} activeOpacity={0.75}>
      <Avatar name={conv.title} uri={conv.avatarUrl} size={52} online={conv.isGroup ? null : conv.online} />
      <View style={s.rowBody}>
        <View style={s.rowTop}>
          <Text style={s.title} numberOfLines={1}>{conv.title}</Text>
          <Text style={[s.time, conv.unread && s.timeUnread]}>{stamp(conv.lastAt)}</Text>
        </View>
        <View style={s.rowBottom}>
          {!!icon && <Ionicons name={icon} size={14} color={COLORS.slate400} style={{ marginRight: 3 }} />}
          <Text style={[s.preview, conv.unread && s.previewUnread]} numberOfLines={1}>
            {conv.lastPreview || (conv.isGroup ? 'Group created' : 'Tap to start chatting')}
          </Text>
          {conv.muted && <Ionicons name="notifications-off" size={13} color={COLORS.slate400} style={{ marginLeft: 5 }} />}
          {conv.pinned && <Ionicons name="pin" size={13} color={COLORS.slate400} style={{ marginLeft: 5 }} />}
          {/* unreadCount can be 0 while unread is true — that's a manual "mark as
              unread", which shows a plain dot rather than a number. */}
          {conv.unread && (
            conv.unreadCount > 0
              ? <View style={s.badge}><Text style={s.badgeTxt}>{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</Text></View>
              : <View style={s.dot} />
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function ChatListScreen({
  onOpenChat, onNewChat, onOpenSearch, onOpenStarred, onOpenSettings,
  onOpenNotifications, onOpenAdmin, onLogout,
}) {
  // Edge-to-edge draws under the nav/gesture bar, so every bottom-anchored list
  // has to reserve that space itself or the last row sits behind the buttons.
  const insets = useSafeAreaInsets();
  const [rowMenu, setRowMenu] = useState(null);   // long-pressed conversation
  const [headerMenu, setHeaderMenu] = useState(false);
  // Unread count for the header bell — the in-app notification feed, not chat
  // unreads. Moved here when the Home dashboard (which used to own the bell) went.
  const [unread, setUnread] = useState(0);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const listRef = useRef(null);
  const [convs, setConvs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const filterRef = useRef(filter);
  useEffect(() => { filterRef.current = filter; }, [filter]);

  const load = useCallback(async (f) => {
    setError(null);
    try {
      const { conversations } = await chat.fetchConversations(f ?? filterRef.current);
      setConvs(conversations);
    } catch (e) {
      log.warn('load failed', e?.message);
      setError(e?.message || 'Could not load chats.');
    }
  }, []);

  useEffect(() => { (async () => { setLoading(true); await load(filter); setLoading(false); })(); }, [filter, load]);

  // The realtime engine polls the 'all' list; only trust its push when that's what
  // we're showing, otherwise its rows would replace a filtered view.
  useEffect(() => {
    realtime.start();
    const off = realtime.subscribe((event, data) => {
      if (event === 'conversations' && filterRef.current === 'all') setConvs(data.conversations);
    });
    return () => { off(); };
  }, []);

  // Refetched on every mount — returning from the feed should show it cleared.
  const loadUnread = useCallback(async () => {
    try { setUnread(await fetchUnreadCount() || 0); }
    catch (e) { log.warn('unread count failed', e?.message); }
  }, []);
  useEffect(() => { loadUnread(); }, [loadUnread]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await Promise.all([load(), loadUnread()]); setRefreshing(false);
  }, [load, loadUnread]);

  // Row actions. Each flips local state first so the list responds instantly,
  // then reconciles from the server — none of these are broadcast on the bus, so
  // a reload is the only way to be sure.
  const rowAction = useCallback(async (kind, c) => {
    setRowMenu(null);
    try {
      if (kind === 'pin') await chat.pinConversation(c.id, !c.pinned);
      if (kind === 'archive') await chat.archiveConversation(c.id, !c.archived);
      if (kind === 'favourite') await chat.favouriteConversation(c.id, !c.favourite);
      if (kind === 'mute') await chat.muteConversation(c.id, !c.muted, 0);
      if (kind === 'unread') await chat.markUnread(c.id);
      if (kind === 'read') await chat.markRead(c.id);
      if (kind === 'delete') {
        await new Promise((resolve, reject) => {
          Alert.alert(
            c.isGroup ? 'Exit group?' : 'Delete chat?',
            c.isGroup
              ? 'You will stop receiving messages from this group.'
              : 'It disappears from your list, and returns if they message you again.',
            [
              { text: 'Cancel', style: 'cancel', onPress: () => reject(new Error('cancelled')) },
              { text: c.isGroup ? 'Exit' : 'Delete', style: 'destructive', onPress: resolve },
            ],
          );
        });
        await chat.leaveChat(c.id);
      }
      await load();
    } catch (e) {
      if (e?.message === 'cancelled') return;
      Alert.alert('Failed', e?.message || 'Please try again.');
      load();
    }
  }, [load]);

  // Logging out drops the session, so it always confirms — a mis-tap in a menu
  // shouldn't end the session.
  const confirmLogout = useCallback(() => {
    Alert.alert('Log out?', "You'll need to sign in again with your username and password.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => onLogout?.() },
    ]);
  }, [onLogout]);

  const markAll = useCallback(async () => {
    setHeaderMenu(false);
    try { await chat.markAllRead(); await load(); }
    catch (e) { Alert.alert('Failed', e?.message || 'Please try again.'); }
  }, [load]);

  // Local filter on top of the server list. Titles already have nicknames applied
  // server-side, so matching on title is the same thing the user sees.
  const q = query.trim().toLowerCase();
  const shown = q
    ? convs.filter((c) => c.title.toLowerCase().includes(q) || c.lastPreview.toLowerCase().includes(q))
    : convs;

  return (
    <Screen>
      {/* This is the app's root screen, so there is no back chevron — the brand
          mark sits where it would have been, as WhatsApp does. */}
      <View style={[s.header, { paddingTop: TOP }]}>
        <Image source={require('../assets/logo369.png')} style={s.logo} resizeMode="contain" />
        <Text style={s.headerTitle}>Chats</Text>
        <TouchableOpacity onPress={onOpenNotifications} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }} style={s.iconBtn}>
          <Ionicons name="notifications-outline" size={21} color={COLORS.navy} />
          {unread > 0 && (
            <View style={s.bellBadge}>
              <Text style={s.bellBadgeTxt}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={onNewChat} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }} style={s.iconBtn}>
          <Ionicons name="create-outline" size={22} color={COLORS.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setHeaderMenu(true)} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }} style={s.iconBtn}>
          <Ionicons name="ellipsis-vertical" size={20} color={COLORS.navy} />
        </TouchableOpacity>
      </View>

      <View style={s.searchWrap}>
        <Ionicons name="search" size={17} color={COLORS.faint} />
        <TextInput
          style={s.search} value={query} onChangeText={setQuery}
          placeholder="Search chats" placeholderTextColor={COLORS.faint}
          returnKeyType="search"
        />
        {!!query && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close-circle" size={17} color={COLORS.faint} />
          </TouchableOpacity>
        )}
      </View>

      <ChipRow chips={FILTERS} value={filter} onChange={setFilter} />

      {loading ? (
        <Loader />
      ) : error ? (
        <View style={emptyWrap}>
          <EmptyState icon="alert-circle-outline" tone="error" title={error} onRetry={onRefresh} />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={shown}
          keyExtractor={(c) => String(c.id)}
          renderItem={({ item }) => (
            <Row conv={item} onPress={() => onOpenChat(item)} onLongPress={() => setRowMenu(item)} />
          )}
          ref={listRef}
          // Room for the FAB so the last row is never trapped under it.
          contentContainerStyle={shown.length ? { paddingBottom: 96 + insets.bottom } : emptyWrap}
          onScroll={(e) => {
            const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
            // Show the arrow only when there is genuinely more list below.
            const remaining = contentSize.height - (contentOffset.y + layoutMeasurement.height);
            setCanScrollDown(remaining > 120);
          }}
          scrollEventThrottle={64}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <EmptyState
              icon="chatbubbles-outline"
              title={q ? 'No matches' : 'No chats yet'}
              sub={q ? 'Try a different search.' : 'Tap the pencil to start one.'}
            />
          }
        />
      )}

      {/* More list below than fits — same affordance as the web client. */}
      {canScrollDown && (
        <TouchableOpacity
          style={[s.scrollDown, { bottom: 92 + insets.bottom }]}
          onPress={() => listRef.current?.scrollToEnd({ animated: true })}
          activeOpacity={0.85}
        >
          <Ionicons name="chevron-down" size={20} color={COLORS.primary} />
        </TouchableOpacity>
      )}

      {/* New chat — WhatsApp's + button. Duplicates the header pencil on purpose:
          it is the primary action and belongs within thumb reach. */}
      <TouchableOpacity
        style={[s.fab, { bottom: 24 + insets.bottom }]}
        onPress={onNewChat}
        activeOpacity={0.9}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Long-press a row — centred dialog, not a bottom sheet. */}
      <PopupModal visible={!!rowMenu} onClose={() => setRowMenu(null)} title={rowMenu?.title}>
        {!!rowMenu && (
          <>
            <ListMenuItem
              icon={rowMenu.pinned ? 'pin' : 'pin-outline'}
              label={rowMenu.pinned ? 'Unpin chat' : 'Pin chat'}
              onPress={() => rowAction('pin', rowMenu)}
            />
            <ListMenuItem
              icon={rowMenu.unread ? 'mail-open-outline' : 'mail-unread-outline'}
              label={rowMenu.unread ? 'Mark as read' : 'Mark as unread'}
              onPress={() => rowAction(rowMenu.unread ? 'read' : 'unread', rowMenu)}
            />
            <ListMenuItem
              icon={rowMenu.muted ? 'notifications-outline' : 'notifications-off-outline'}
              label={rowMenu.muted ? 'Unmute' : 'Mute notifications'}
              onPress={() => rowAction('mute', rowMenu)}
            />
            <ListMenuItem
              icon={rowMenu.favourite ? 'star' : 'star-outline'}
              label={rowMenu.favourite ? 'Remove favourite' : 'Add to favourites'}
              onPress={() => rowAction('favourite', rowMenu)}
            />
            <ListMenuItem
              icon={rowMenu.archived ? 'file-tray-outline' : 'archive-outline'}
              label={rowMenu.archived ? 'Unarchive' : 'Archive'}
              onPress={() => rowAction('archive', rowMenu)}
            />
            <ListMenuItem
              icon="exit-outline"
              label={rowMenu.isGroup ? 'Exit group' : 'Delete chat'}
              tone="danger"
              onPress={() => rowAction('delete', rowMenu)}
            />
          </>
        )}
      </PopupModal>

      {/* Header ⋮ — drops from the button, like WhatsApp. */}
      <MenuPopup
        visible={headerMenu}
        onClose={() => setHeaderMenu(false)}
        // Mirrors the web client's ⋮ menu. Search moved to the search field
        // above (which now searches every chat), and the admin screens were
        // dropped from here on purpose — they are not part of the chat surface.
        items={[
          { key: 'newgroup', icon: 'people-outline', label: 'New group', onPress: () => onNewChat?.({ group: true }) },
          { key: 'starred', icon: 'star-outline', label: 'Starred messages', onPress: () => onOpenStarred?.() },
          { key: 'markall', icon: 'checkmark-done-outline', label: 'Mark all as read', onPress: markAll },
          { key: 'settings', icon: 'settings-outline', label: 'Settings', onPress: () => onOpenSettings?.() },
          { key: 'logout', icon: 'log-out-outline', label: 'Log out', tone: 'danger', onPress: confirmLogout },
        ]}
      />
    </Screen>
  );
}

function ListMenuItem({ icon, label, onPress, tone }) {
  return (
    <TouchableOpacity style={s.menuItem} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={20} color={tone === 'danger' ? COLORS.red : COLORS.primary} />
      <Text style={[s.menuTxt, tone === 'danger' && { color: COLORS.red }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md,
  },
  // Left-aligned, not centred: with three actions on the right the title reads
  // as a brand line rather than a page title.
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '900', color: COLORS.navy, marginLeft: SPACING.md },
  logo: { width: 34, height: 34 },
  iconBtn: {
    width: 40, height: 40, borderRadius: RADIUS.lg, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },
  bellBadge: {
    position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3, borderWidth: 1.5, borderColor: '#fff',
  },
  bellBadgeTxt: { color: '#fff', fontSize: 9, fontWeight: '900' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginHorizontal: SPACING.screen, marginBottom: SPACING.md,
    backgroundColor: '#fff', borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.line,
    paddingHorizontal: SPACING.lg, height: 42,
  },
  search: { flex: 1, fontSize: 14.5, color: COLORS.ink, paddingVertical: 0 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
  },
  rowBody: { flex: 1, borderBottomWidth: 1, borderBottomColor: COLORS.slate100, paddingBottom: SPACING.md },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, fontSize: 15.5, fontWeight: '800', color: COLORS.slate900, marginRight: SPACING.sm },
  time: { fontSize: 11.5, color: COLORS.slate400, fontWeight: '600' },
  timeUnread: { color: COLORS.green, fontWeight: '800' },
  rowBottom: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  preview: { flex: 1, fontSize: 13.5, color: COLORS.slate500 },
  previewUnread: { color: COLORS.slate700, fontWeight: '700' },

  badge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.green,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: SPACING.sm,
  },
  badgeTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.green, marginLeft: SPACING.sm },

  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.screen,
    paddingVertical: SPACING.screen, paddingHorizontal: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line,
  },
  menuTxt: { fontSize: 15.5, fontWeight: '700', color: COLORS.ink },

  fab: {
    position: 'absolute', right: SPACING.screen,
    width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.primary, shadowOpacity: 0.35, shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 }, elevation: 6,
  },
  scrollDown: {
    position: 'absolute', right: SPACING.screen + 8,
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },
});
