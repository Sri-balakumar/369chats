// CHATS — the conversation list. The app's main chat surface.
//
// Rows come from /chat/conversations already sorted (pinned first, then last
// activity) and already filtered, so this screen never re-sorts; it just renders.
// The realtime engine pushes a fresh list every few seconds.
import React, { useState, useEffect, useCallback, useRef } from 'react';
// (useRef is used for the list handle and the filter mirror.)
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput, FlatList, ScrollView,
  RefreshControl, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SHADOW, RADIUS, SPACING, TOP, themed } from '../theme';
import {
  Screen, ChipRow, Loader, EmptyState, Avatar, PopupModal, MenuPopup, ConfirmDialog, Switch, emptyWrap,
} from '../components/ui';
import { TABBAR_SPACE, TABBAR_HEIGHT, tabbarBottom } from '../components/chat/BottomTabs';
import NowPlayingBar from '../components/chat/NowPlayingBar';
import MuteSheet, { mutedUntilLabel } from '../components/chat/MuteSheet';
import usePlaceCall from '../hooks/usePlaceCall';
import useBackIntercept from '../hooks/useBackIntercept';
import * as chat from '../services/chat';
import realtime from '../services/chatRealtime';
import { draftFor } from '../services/drafts';
import { createLogger } from '../api/logger';

const log = createLogger('ChatList');

// The + shares the bottom band with the tab pill, so its size is needed both for
// the style block and to centre it against TABBAR_HEIGHT.
const FAB_SIZE = 56;

// Archived is deliberately NOT a chip. WhatsApp treats the archive as a place
// you go, not a filter you apply: a single row pinned above the list, opening a
// screen of its own. A chip alongside All/Unread also made "Archived" look like
// a view of the same list, when it is the one filter that shows chats the others
// all hide.
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'favourites', label: 'Favourites' },
  { key: 'groups', label: 'Groups' },
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
  // An unsent draft outranks the last message in the preview slot — it is the
  // thing the user left unfinished.
  const draft = draftFor(conv.id);
  return (
    <TouchableOpacity style={s.row} onPress={onPress} onLongPress={onLongPress} activeOpacity={0.75}>
      <Avatar name={conv.title} uri={conv.avatarUrl} size={52} online={conv.isGroup ? null : conv.online} />
      <View style={s.rowBody}>
        <View style={s.rowTop}>
          <Text style={s.title} numberOfLines={1}>{conv.title}</Text>
          <Text style={[s.time, conv.unread && s.timeUnread]} numberOfLines={1}>{stamp(conv.lastAt)}</Text>
        </View>
        <View style={s.rowBottom}>
          {!draft && !!icon && <Ionicons name={icon} size={14} color={COLORS.slate400} style={{ marginRight: 3 }} />}
          <Text style={[s.preview, conv.unread && s.previewUnread]} numberOfLines={1}>
            {draft
              ? <Text><Text style={s.draftTag}>Draft: </Text>{draft}</Text>
              : (conv.lastPreview || (conv.isGroup ? 'Group created' : 'Tap to start chatting'))}
          </Text>
          {conv.muted && <Ionicons name="notifications-off" size={13} color={COLORS.slate400} style={{ marginLeft: 5 }} />}
          {conv.pinned && <Ionicons name="pin" size={13} color={COLORS.slate400} style={{ marginLeft: 5 }} />}
          {/* Without this a favourited chat looked identical to any other unless
              you happened to be standing in the Favourites filter. */}
          {conv.favourite && <Ionicons name="heart" size={12} color={COLORS.red} style={{ marginLeft: 5 }} />}
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
  onOpenNotifications, onOpenAdmin, onOpenHit, onLogout,
}) {
  // Edge-to-edge draws under the nav/gesture bar, so every bottom-anchored list
  // has to reserve that space itself or the last row sits behind the buttons.
  const insets = useSafeAreaInsets();
  const [rowMenu, setRowMenu] = useState(null);   // long-pressed conversation
  const [headerMenu, setHeaderMenu] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  // Custom lists (chat.list) become extra filter chips alongside the built-ins.
  const [lists, setLists] = useState([]);
  const [listAsk, setListAsk] = useState(false);
  const [listName, setListName] = useState('');
  const [listPick, setListPick] = useState([]);     // conversations to seed a new list with
  const [addToList, setAddToList] = useState(null); // conversation being filed into lists
  const [listErr, setListErr] = useState(null);     // /chat/lists failed — shown under the chips
  const [confirmList, setConfirmList] = useState(null);  // list awaiting delete confirmation
  const [confirmLeave, setConfirmLeave] = useState(null); // chat awaiting exit/delete confirmation
  const [muteAsk, setMuteAsk] = useState(null);   // chat awaiting a mute duration

  // No conversation passed: each row menu targets its own chat, so the gate is
  // only "can this build call" and the row supplies the target.
  const { placeCall, callErr, clearCallErr } = usePlaceCall();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [hits, setHits] = useState(null);        // message search results, null = not searching
  const [searching, setSearching] = useState(false);
  const listRef = useRef(null);
  const searchTimer = useRef(null);
  const [convs, setConvs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const filterRef = useRef(filter);

  // The archive is a destination, not a filter — `inArchive` swaps the header
  // and the list for it. { count, unread } comes back with every fetch so the
  // row above the list can show what is in there without a second request.
  const [inArchive, setInArchive] = useState(false);
  const [archived, setArchived] = useState({ count: 0, unread: 0 });
  const [archSettings, setArchSettings] = useState(false);

  // Android back inside the archive used to CLOSE THE APP: the archive is state
  // here, not a route, so App.js's BackHandler found nothing to pop and let the
  // OS exit. Same for a live search — back should clear it before leaving.
  useBackIntercept(inArchive, () => { setInArchive(false); return true; });
  useBackIntercept(!inArchive && !!query, () => { setQuery(''); return true; });
  // Both default to the WhatsApp behaviour until /chat/me answers: keep chats
  // archived, row at the top.
  const [archPrefs, setArchPrefs] = useState({ keepArchived: true, atBottom: false });

  useEffect(() => {
    let alive = true;
    chat.fetchMe()
      .then((me) => {
        if (alive) setArchPrefs({ keepArchived: me.keepArchived, atBottom: me.archiveAtBottom });
      })
      .catch(() => {});   // the defaults above are the right fallback
    return () => { alive = false; };
  }, []);

  // Optimistic: flip locally, then persist. A failed write reloads the truth.
  const setArchPref = useCallback(async (key, value) => {
    setArchPrefs((p) => ({ ...p, [key]: value }));
    try {
      await chat.saveSettings(key === 'keepArchived'
        ? { keep_archived: value }
        : { archive_at_bottom: value });
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Could not save the setting.');
      chat.fetchMe()
        .then((me) => setArchPrefs({ keepArchived: me.keepArchived, atBottom: me.archiveAtBottom }))
        .catch(() => {});
    }
  }, []);

  const load = useCallback(async (f) => {
    setError(null);
    try {
      const res = await chat.fetchConversations(f ?? filterRef.current);
      setConvs(res.conversations);
      setArchived({ count: res.archivedCount, unread: res.archivedUnread });
    } catch (e) {
      log.warn('load failed', e?.message);
      setError(e?.message || 'Could not load chats.');
    }
  }, []);

  // Inside the archive the filter chips do not apply — it is its own list.
  const effFilter = inArchive ? 'archived' : filter;
  useEffect(() => { filterRef.current = effFilter; }, [effFilter]);

  useEffect(() => { (async () => { setLoading(true); await load(effFilter); setLoading(false); })(); }, [effFilter, load]);

  // The realtime engine polls the 'all' list; only trust its push when that's what
  // we're showing, otherwise its rows would replace a filtered view — including
  // the archive, whose rows are exactly the ones 'all' leaves out.
  useEffect(() => {
    realtime.start();
    const off = realtime.subscribe((event, data) => {
      if (event === 'conversations' && filterRef.current === 'all') setConvs(data.conversations);
    });
    return () => { off(); };
  }, []);

  // A failed /chat/lists used to be swallowed into log.warn, which api/logger
  // suppresses outside __DEV__ — so a broken session looked exactly like "you
  // have no lists". Say so instead, without blocking the conversation list.
  const loadLists = useCallback(async () => {
    try { setLists(await chat.fetchLists()); setListErr(null); }
    catch (e) { log.warn('lists failed', e?.message); setListErr(e?.message || 'Could not load your lists.'); }
  }, []);
  useEffect(() => { loadLists(); }, [loadLists]);

  // There is no rename route server-side — a list can only be created, toggled
  // or deleted — so this is create-only and deletion lives on the chip long-press.
  // Chats can be chosen while creating, which is what the web client does — the
  // API takes conversation_ids up front, so there is no reason to make the user
  // create an empty list and then file chats into it one at a time.
  const createList = useCallback(async () => {
    const name = listName.trim();
    if (!name) return;
    setListAsk(false);
    setListName('');
    const ids = listPick;
    setListPick([]);
    try { await chat.createList(name, '', ids); await loadLists(); }
    catch (e) { Alert.alert('Failed', e?.message || 'Could not create the list.'); }
  }, [listName, listPick, loadLists]);

  // Toggle one conversation in/out of a list. Patch the single row from what the
  // server hands back rather than reloading: loadLists() calls /chat/lists with no
  // conversation_id, and the route only reports `has` when it is given one — so a
  // reload would blank every tick in the modal that is still open.
  const toggleInList = useCallback(async (listId, conversationId) => {
    try {
      const { has, count } = await chat.toggleList(listId, conversationId);
      setLists((prev) => prev.map((l) => (l.id === listId ? { ...l, has, count } : l)));
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Could not update the list.');
    }
  }, []);

  // Which lists already contain this chat — /chat/lists reports `has` when it is
  // given a conversation_id.
  const openAddToList = useCallback(async (conv) => {
    setRowMenu(null);
    try {
      const withHas = await chat.fetchLists(conv.id);
      setLists(withHas);
      setAddToList(conv);
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Could not load your lists.');
    }
  }, []);

  const removeList = useCallback((l) => setConfirmList(l), []);

  const doRemoveList = useCallback(async () => {
    const l = confirmList;
    setConfirmList(null);
    if (!l) return;
    try {
      await chat.deleteList(l.id);
      if (filter === String(l.id)) setFilter('all');
      await loadLists();
    } catch (e) { Alert.alert('Failed', e?.message || 'Please try again.'); }
  }, [confirmList, filter, loadLists]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  // Row actions. Each flips local state first so the list responds instantly,
  // then reconciles from the server — none of these are broadcast on the bus, so
  // a reload is the only way to be sure.
  const rowAction = useCallback(async (kind, c) => {
    setRowMenu(null);
    try {
      if (kind === 'pin') await chat.pinConversation(c.id, !c.pinned);
      if (kind === 'archive') await chat.archiveConversation(c.id, !c.archived);
      if (kind === 'favourite') await chat.favouriteConversation(c.id, !c.favourite);
      // Muting asks for how long (WhatsApp does, and so does the thread's ⋮).
      // Un-muting is immediate — there is nothing to ask.
      if (kind === 'mute') {
        if (c.muted) await chat.muteConversation(c.id, false, 0);
        else { setMuteAsk(c); return; }
      }
      if (kind === 'unread') await chat.markUnread(c.id);
      if (kind === 'read') await chat.markRead(c.id);
      // Hand off to the confirm layer instead of blocking on a promise inside a
      // native Alert — the row menu is a Modal, so a second Modal would lose the
      // race, and an Alert renders white on dark.
      if (kind === 'delete') { setConfirmLeave(c); return; }
      await load();
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Please try again.');
      load();
    }
  }, [load]);

  const markAll = useCallback(async () => {
    setHeaderMenu(false);
    try { await chat.markAllRead(); await load(); }
    catch (e) { Alert.alert('Failed', e?.message || 'Please try again.'); }
  }, [load]);

  // Typing searches MESSAGES across every chat, not just the visible rows.
  // /chat/search_all needs 2+ characters and is a plain ILIKE, so it is debounced
  // and the chat-title filter below still runs for 1-character queries.
  useEffect(() => {
    const q = query.trim();
    clearTimeout(searchTimer.current);
    if (q.length < 2) { setHits(null); setSearching(false); return undefined; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try { setHits(await chat.searchAll(q)); }
      catch (e) { log.warn('search failed', e?.message); setHits([]); }
      finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [query]);

  // Local filter on top of the server list. Titles already have nicknames applied
  // server-side, so matching on title is the same thing the user sees.
  const q = query.trim().toLowerCase();
  const shown = q
    ? convs.filter((c) => c.title.toLowerCase().includes(q) || c.lastPreview.toLowerCase().includes(q))
    : convs;

  // The archive entry. Hidden while searching (results are their own thing),
  // inside the archive itself, and when there is nothing archived — an
  // "Archived 0" row is a dead end that only takes up space. Placement is the
  // user's choice, so it is built once and slotted in as header or footer.
  const showArchRow = !inArchive && !q && archived.count > 0;
  const archRow = (
    <TouchableOpacity
      style={[s.archRow, archPrefs.atBottom && s.archRowBottom]}
      activeOpacity={0.7}
      onPress={() => { setInArchive(true); setRowMenu(null); }}
    >
      <Ionicons name="archive-outline" size={20} color={COLORS.slate500} />
      <Text style={s.archTxt}>Archived</Text>
      {/* Always the number of archived CHATS. Showing the unread MESSAGE count
          instead made one archived chat with five unread read as "Archived 5".
          Unread only tints it. */}
      <Text style={archived.unread > 0 ? s.archUnread : s.archCount}>
        {archived.count}
      </Text>
    </TouchableOpacity>
  );

  return (
    <Screen>
      {/* This is the app's root screen, so there is no back chevron. The product
          name carries the branding here — a logo mark next to it was redundant,
          since the artwork spells out "369Chats" itself. */}
      <View style={[s.header, { paddingTop: TOP }]}>
        {/* The archive gets a back chevron and its own title — it is a place you
            navigated to. The root list has no back, so the product name sits
            where the chevron would be. */}
        {inArchive ? (
          <>
            <TouchableOpacity
              onPress={() => setInArchive(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={s.iconBtn}
            >
              <Ionicons name="arrow-back" size={22} color={COLORS.navy} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>Archived</Text>
            <TouchableOpacity
              onPress={() => setArchSettings(true)}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              style={s.iconBtn}
            >
              <Ionicons name="ellipsis-vertical" size={20} color={COLORS.navy} />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={s.headerTitle}>369Chats</Text>
            {/* The notification bell was removed: chat unreads already show on the
                rows, the tab badge and the ⋮, so a second unread language in the
                same header was noise. The feed is still reachable from Settings. */}
            <TouchableOpacity onPress={onNewChat} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }} style={s.iconBtn}>
              <Ionicons name="create-outline" size={22} color={COLORS.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setHeaderMenu(true)} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }} style={s.iconBtn}>
              <Ionicons name="ellipsis-vertical" size={20} color={COLORS.navy} />
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Global search and the filter chips both belong to the main list. The
          archive is a short, self-contained list — WhatsApp gives it neither. */}
      {!inArchive && (
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
      )}

      {/* Filters are irrelevant while searching messages. Custom lists appear as
          extra chips after the built-ins, with a + to add one. Long-press a list
          chip to delete it — there is no rename route server-side. */}
      {!hits && !inArchive && (
        <View style={s.filterRow}>
          <View style={{ flex: 1 }}>
            <ChipRow
              chips={[
                ...FILTERS,
                ...lists.map((l) => ({
                  key: String(l.id),
                  label: `${l.emoji ? `${l.emoji} ` : ''}${l.name}`,
                  count: l.count,
                })),
              ]}
              value={filter}
              onChange={setFilter}
              onLongPress={(key) => {
                const l = lists.find((x) => String(x.id) === String(key));
                if (l) removeList(l);
              }}
            />
          </View>
          <TouchableOpacity style={s.addList} onPress={() => setListAsk(true)} activeOpacity={0.8}>
            <Ionicons name="add" size={18} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      )}
      {/* Voice note still playing after leaving the thread. */}
      <NowPlayingBar onOpen={(cid) => cid && onOpenChat?.({ id: cid, title: 'Chat' })} />

      {!hits && !!listErr && (
        <TouchableOpacity style={s.listErr} onPress={loadLists} activeOpacity={0.7}>
          <Ionicons name="alert-circle-outline" size={14} color={COLORS.red} />
          <Text style={s.listErrTxt} numberOfLines={1}>{listErr} Tap to retry.</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <Loader />
      ) : error ? (
        <View style={emptyWrap}>
          <EmptyState icon="alert-circle-outline" tone="error" title={error} onRetry={onRefresh} />
        </View>
      ) : hits ? (
        // Message search across every chat. Matching chat NAMES stay on top, then
        // the message hits — the same two-section shape the web client uses.
        <FlatList
          style={{ flex: 1 }}
          data={hits}
          keyExtractor={(h) => `m${h.messageId}`}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={hits.length ? { paddingBottom: 96 + insets.bottom } : emptyWrap}
          ListHeaderComponent={
            shown.length ? (
              <>
                <Text style={s.searchHead}>Chats</Text>
                {shown.slice(0, 4).map((c) => (
                  <Row key={c.id} conv={c} onPress={() => onOpenChat(c)} onLongPress={() => setRowMenu(c)} />
                ))}
                <Text style={s.searchHead}>Messages</Text>
              </>
            ) : null
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.hitRow}
              activeOpacity={0.75}
              onPress={() => onOpenHit?.(item.conversationId, item.messageId, item.conversationTitle)}
            >
              <View style={s.hitTop}>
                <Text style={s.hitChat} numberOfLines={1}>{item.conversationTitle}</Text>
                <Text style={s.hitWhen}>{stamp(item.created)}</Text>
              </View>
              <Text style={s.hitSnippet} numberOfLines={2}>
                {item.author ? `${item.author}: ` : ''}{item.snippet}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="search-outline"
              title={searching ? 'Searching…' : 'No messages found'}
              sub={searching ? undefined : 'Try different words.'}
            />
          }
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={shown}
          keyExtractor={(c) => String(c.id)}
          renderItem={({ item }) => (
            <Row conv={item} onPress={() => onOpenChat(item)} onLongPress={() => setRowMenu(item)} />
          )}
          ref={listRef}
          // The archive entry, pinned above the chats — WhatsApp's placement.
          // Hidden while searching (the results are their own thing), inside the
          // archive itself, and when there is nothing archived: an "Archived (0)"
          // row is a dead end that only takes up space.
          ListHeaderComponent={showArchRow && !archPrefs.atBottom ? archRow : null}
          ListFooterComponent={showArchRow && archPrefs.atBottom ? archRow : null}
          // Room for the FAB AND the floating tab bar, which overlays content.
          contentContainerStyle={shown.length ? { paddingBottom: 96 + TABBAR_SPACE + insets.bottom } : emptyWrap}
          onScroll={(e) => {
            const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
            // Show the arrow only when there is genuinely more list below.
            const remaining = contentSize.height - (contentOffset.y + layoutMeasurement.height);
            setCanScrollDown(remaining > 120);
          }}
          scrollEventThrottle={64}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} progressBackgroundColor={COLORS.card} />}
          ListEmptyComponent={
            <EmptyState
              icon={inArchive ? 'archive-outline' : 'chatbubbles-outline'}
              title={inArchive ? 'No archived chats' : (q ? 'No matches' : 'No chats yet')}
              sub={inArchive
                ? 'Long-press any chat and choose Archive to move it here.'
                : (q ? 'Try a different search.' : 'Tap the pencil to start one.')}
            />
          }
        />
      )}

      {/* More list below than fits — same affordance as the web client. Sits
          above the whole bottom band, clear of both the pill and the +. */}
      {canScrollDown && (
        <TouchableOpacity
          style={[s.scrollDown, { bottom: TABBAR_SPACE + 12 + insets.bottom }]}
          onPress={() => listRef.current?.scrollToEnd({ animated: true })}
          activeOpacity={0.85}
        >
          <Ionicons name="chevron-down" size={20} color={COLORS.primary} />
        </TouchableOpacity>
      )}

      {/* New chat. Shares the bottom band WITH the tab pill rather than floating
          above it: the pill is centred, so the + takes the right end of the same
          line and the row reads as one control strip. Centred against the pill's
          height so the two line up however the pill changes. */}
      {/* Not in the archive: a new chat would land in the main list, not here,
          so offering it from this screen would be misleading. */}
      {!inArchive && (
        <TouchableOpacity
          style={[s.fab, { bottom: tabbarBottom(insets.bottom) + (TABBAR_HEIGHT - FAB_SIZE) / 2 }]}
          onPress={onNewChat}
          activeOpacity={0.9}
        >
          <Ionicons name="add" size={28} color={COLORS.onPrimary} />
        </TouchableOpacity>
      )}

      {/* New list — name AND the chats to put in it, in one step. */}
      <PopupModal
        visible={listAsk}
        onClose={() => { setListAsk(false); setListName(''); setListPick([]); }}
        title="New list"
        subtitle="Group chats together so you can filter to them quickly."
      >
        <View style={{ paddingHorizontal: SPACING.xl, paddingTop: SPACING.md }}>
          <TextInput
            style={s.listInput}
            value={listName}
            onChangeText={setListName}
            placeholder="List name"
            placeholderTextColor={COLORS.faint}
            autoFocus
            returnKeyType="done"
          />
          <Text style={s.pickHead}>
            Add chats{listPick.length ? ` · ${listPick.length} selected` : ''}
          </Text>
        </View>
        <ScrollView style={{ maxHeight: 260 }}>
          {convs.map((c) => {
            const on = listPick.includes(c.id);
            return (
              <TouchableOpacity
                key={c.id}
                style={s.pickRow}
                activeOpacity={0.75}
                onPress={() => setListPick((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}
              >
                <Avatar name={c.title} uri={c.avatarUrl} size={36} />
                <Text style={s.pickName} numberOfLines={1}>{c.title}</Text>
                <View style={[s.check, on && s.checkOn]}>
                  {on && <Ionicons name="checkmark" size={14} color={COLORS.onPrimary} />}
                </View>
              </TouchableOpacity>
            );
          })}
          {!convs.length && <Text style={s.pickEmpty}>No chats yet.</Text>}
        </ScrollView>
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md }}>
          <TouchableOpacity
            style={[s.listBtn, !listName.trim() && { backgroundColor: COLORS.slate400 }]}
            disabled={!listName.trim()}
            onPress={createList}
          >
            <Text style={s.listBtnTxt}>Create list</Text>
          </TouchableOpacity>
        </View>
      </PopupModal>

      {/* File one chat into any of your lists. */}
      <PopupModal
        visible={!!addToList}
        onClose={() => setAddToList(null)}
        title="Add to list"
        subtitle={addToList?.title}
      >
        <ScrollView style={{ maxHeight: 300 }}>
          {lists.map((l) => (
            <TouchableOpacity
              key={l.id}
              style={s.pickRow}
              activeOpacity={0.75}
              onPress={() => toggleInList(l.id, addToList.id)}
            >
              <Text style={s.listEmoji}>{l.emoji || '📁'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.pickName} numberOfLines={1}>{l.name}</Text>
                <Text style={s.pickMeta}>{l.count} {l.count === 1 ? 'chat' : 'chats'}</Text>
              </View>
              <View style={[s.check, l.has && s.checkOn]}>
                {l.has && <Ionicons name="checkmark" size={14} color={COLORS.onPrimary} />}
              </View>
            </TouchableOpacity>
          ))}
          {!lists.length && (
            <Text style={s.pickEmpty}>No lists yet — create one with the + beside the filters.</Text>
          )}
        </ScrollView>
      </PopupModal>

      {/* Long-press a row — centred dialog, not a bottom sheet. */}
      <PopupModal visible={!!rowMenu} onClose={() => setRowMenu(null)} title={rowMenu?.title}>
        {!!rowMenu && (
          <>
            {/* Ring someone without opening the chat first, as WhatsApp does.
                1:1 only — the server refuses group calls. */}
            {!rowMenu.isGroup && !rowMenu.blockedByMe && (
              <>
                <ListMenuItem
                  icon="call-outline"
                  label="Voice call"
                  onPress={() => { setRowMenu(null); placeCall(false, rowMenu); }}
                />
                <ListMenuItem
                  icon="videocam-outline"
                  label="Video call"
                  onPress={() => { setRowMenu(null); placeCall(true, rowMenu); }}
                />
              </>
            )}
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
              sub={rowMenu.muted ? mutedUntilLabel(rowMenu.mutedUntil) : undefined}
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
              icon="albums-outline"
              label="Add to list"
              onPress={() => openAddToList(rowMenu)}
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
          // The bell came out of the header, so the feed lives here now — without
          // this entry the Notifications screen would have no way in at all.
          { key: 'notifs', icon: 'notifications-outline', label: 'Notifications', onPress: () => onOpenNotifications?.() },
          { key: 'markall', icon: 'checkmark-done-outline', label: 'Mark all as read', onPress: markAll },
          { key: 'settings', icon: 'settings-outline', label: 'Settings', onPress: () => onOpenSettings?.() },
          // Also in Settings → Account; both entry points are intentional.
          { key: 'logout', icon: 'log-out-outline', label: 'Log out', tone: 'danger', onPress: () => setConfirmLogout(true) },
        ]}
      />

      {/* In-tree confirm layers, last so they paint above everything. */}
      <ConfirmDialog
        visible={!!confirmList}
        icon="albums-outline"
        title={confirmList ? `Delete “${confirmList.name}”?` : 'Delete list?'}
        message="The list is removed. The chats in it are not affected."
        actions={[{ key: 'del', label: 'Delete list', tone: 'danger', onPress: doRemoveList }]}
        onCancel={() => setConfirmList(null)}
      />

      <ConfirmDialog
        visible={!!confirmLeave}
        icon={confirmLeave?.isGroup ? 'exit-outline' : 'trash-outline'}
        title={confirmLeave?.isGroup ? 'Exit group?' : 'Delete chat?'}
        message={confirmLeave?.isGroup
          ? 'You will stop receiving messages from this group.'
          : 'It disappears from your list, and returns if they message you again.'}
        actions={[{
          key: 'go',
          label: confirmLeave?.isGroup ? 'Exit group' : 'Delete chat',
          tone: 'danger',
          onPress: async () => {
            const c = confirmLeave;
            setConfirmLeave(null);
            try { await chat.leaveChat(c.id); await load(); }
            catch (e) { Alert.alert('Failed', e?.message || 'Please try again.'); load(); }
          },
        }]}
        onCancel={() => setConfirmLeave(null)}
      />

      <ConfirmDialog
        visible={confirmLogout}
        icon="log-out-outline"
        title="Log out?"
        message="You'll need to sign in again with your username and password."
        actions={[{
          key: 'out',
          label: 'Log out',
          tone: 'danger',
          onPress: () => { setConfirmLogout(false); onLogout?.(); },
        }]}
        onCancel={() => setConfirmLogout(false)}
      />

      {/* Archive settings — reached from the ⋮ inside the archive, as WhatsApp
          does. Both preferences live on the server so the app and the web agree. */}
      <PopupModal
        visible={archSettings}
        onClose={() => setArchSettings(false)}
        title="Archive settings"
      >
        <View style={s.archOpt}>
          <View style={{ flex: 1 }}>
            <Text style={s.archOptTxt}>Keep chats archived</Text>
            <Text style={s.archOptSub}>
              Archived chats stay archived when a new message arrives. Turn this
              off and a new message brings the chat back to your list.
            </Text>
          </View>
          <Switch
            value={archPrefs.keepArchived}
            onValueChange={(v) => setArchPref('keepArchived', v)}
          />
        </View>
        <View style={s.archOpt}>
          <View style={{ flex: 1 }}>
            <Text style={s.archOptTxt}>Show archived at the bottom</Text>
            <Text style={s.archOptSub}>
              Move the Archived row to the end of the chat list instead of the top.
            </Text>
          </View>
          <Switch
            value={archPrefs.atBottom}
            onValueChange={(v) => setArchPref('atBottom', v)}
          />
        </View>
      </PopupModal>

      <ConfirmDialog
        visible={!!callErr}
        icon="call-outline"
        tone="danger"
        title="Can't start the call"
        message={callErr || ''}
        actions={[]}
        cancelLabel="OK"
        onCancel={clearCallErr}
      />

      <MuteSheet
        visible={!!muteAsk}
        onClose={() => setMuteAsk(null)}
        onPick={async (hours, opt) => {
          const c = muteAsk;
          setMuteAsk(null);
          if (!c) return;
          try {
            await chat.muteConversation(c.id, true, hours);
            Alert.alert('Muted', `Notifications are off ${opt.confirm}.`);
            await load();
          } catch (e) {
            Alert.alert('Failed', e?.message || 'Could not mute.');
            load();
          }
        }}
      />
    </Screen>
  );
}

function ListMenuItem({ icon, label, sub, onPress, tone }) {
  return (
    <TouchableOpacity style={s.menuItem} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={20} color={tone === 'danger' ? COLORS.red : COLORS.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[s.menuTxt, tone === 'danger' && { color: COLORS.red }]}>{label}</Text>
        {!!sub && <Text style={s.menuSub}>{sub}</Text>}
      </View>
    </TouchableOpacity>
  );
}

const s = themed((C) => ({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md,
  },
  // Left-aligned, not centred: with three actions on the right the title reads
  // as a brand line rather than a page title.
  // No marginLeft any more — that only existed to clear the logo mark.
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '900', color: C.navy },
  iconBtn: {
    width: 40, height: 40, borderRadius: RADIUS.lg, backgroundColor: COLORS.card,
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginHorizontal: SPACING.screen, marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: C.line,
    paddingHorizontal: SPACING.lg, height: 42,
  },
  search: { flex: 1, fontSize: 14.5, color: C.ink, paddingVertical: 0 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
  },
  rowBody: { flex: 1, borderBottomWidth: 1, borderBottomColor: C.slate100, paddingBottom: SPACING.md },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, fontSize: 15.5, fontWeight: '800', color: C.slate900, marginRight: SPACING.sm },
  // The title beside this is flex:1, so without a floor the longest stamps
  // ("Yesterday", "31/12/25") get squeezed and lose their last glyph.
  time: { fontSize: 11.5, color: C.slate400, fontWeight: '600', flexShrink: 0, minWidth: 62, textAlign: 'right' },
  timeUnread: { color: C.accent, fontWeight: '800' },
  rowBottom: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  preview: { flex: 1, fontSize: 13.5, color: C.slate500 },
  previewUnread: { color: C.slate700, fontWeight: '700' },

  badge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: SPACING.sm,
  },
  badgeTxt: { color: COLORS.onPrimary, fontSize: 11, fontWeight: '800' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent, marginLeft: SPACING.sm },

  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.screen,
    paddingVertical: SPACING.screen, paddingHorizontal: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  menuTxt: { fontSize: 15.5, fontWeight: '700', color: C.ink },
  menuSub: { fontSize: 11.5, color: C.slate500, marginTop: 1 },

  // The "Archived" entry above the chat list.
  archRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingHorizontal: SPACING.screen, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  // At the bottom the divider belongs above the row, not below it.
  archRowBottom: {
    borderBottomWidth: 0,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line,
  },
  archTxt: { flex: 1, fontSize: 15, fontWeight: '700', color: C.ink },
  archCount: { fontSize: 12.5, fontWeight: '700', color: C.slate500 },
  archUnread: { fontSize: 12.5, fontWeight: '900', color: C.primary },
  archOpt: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md,
  },
  archOptTxt: { fontSize: 14.5, fontWeight: '700', color: C.ink },
  archOptSub: { fontSize: 11.5, color: C.slate500, marginTop: 2, lineHeight: 16 },

  filterRow: { flexDirection: 'row', alignItems: 'center' },
  draftTag: { color: C.red, fontWeight: '700' },
  listErr: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    paddingHorizontal: SPACING.screen, paddingBottom: SPACING.sm,
  },
  listErrTxt: { flex: 1, fontSize: 12.5, fontWeight: '600', color: C.red },
  addList: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.tintBg,
    alignItems: 'center', justifyContent: 'center',
    marginRight: SPACING.screen, marginBottom: SPACING.sm,
  },
  listInput: {
    backgroundColor: C.slate50, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: C.line,
    paddingHorizontal: SPACING.screen, height: 46, fontSize: 15, color: C.ink,
  },
  listBtn: {
    height: 48, borderRadius: RADIUS.lg, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: SPACING.screen,
  },
  listBtnTxt: { color: COLORS.onPrimary, fontSize: 15.5, fontWeight: '800' },

  pickHead: {
    fontSize: 12, fontWeight: '900', color: C.muted, letterSpacing: 0.7,
    marginTop: SPACING.screen, marginBottom: SPACING.xs, textTransform: 'uppercase',
  },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  pickName: { flex: 1, fontSize: 14.5, fontWeight: '700', color: C.ink },
  pickMeta: { fontSize: 11.5, color: C.slate500, marginTop: 1 },
  pickEmpty: { fontSize: 13.5, color: C.slate500, padding: SPACING.xl, textAlign: 'center' },
  listEmoji: { fontSize: 22, width: 36, textAlign: 'center' },
  check: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: C.primary, borderColor: C.primary },

  searchHead: {
    fontSize: 12, fontWeight: '900', color: C.muted, letterSpacing: 0.7,
    paddingHorizontal: SPACING.screen, paddingTop: SPACING.screen,
    paddingBottom: SPACING.xs, textTransform: 'uppercase',
  },
  hitRow: {
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  hitTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hitChat: { flex: 1, fontSize: 14, fontWeight: '800', color: C.navy },
  hitWhen: { fontSize: 11.5, color: C.slate400 },
  hitSnippet: { fontSize: 13.5, color: C.slate500, marginTop: 3 },

  fab: {
    position: 'absolute', right: SPACING.screen,
    width: FAB_SIZE, height: FAB_SIZE, borderRadius: FAB_SIZE / 2, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 }, elevation: 6,
  },
  scrollDown: {
    position: 'absolute', right: SPACING.screen + 8,
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.card,
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },
}));
