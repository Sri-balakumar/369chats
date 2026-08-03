// CALLS — history, favourites and scheduled calls.
//
// Calls CAN be placed from here: favourites offer voice and video, and a Recent
// row calls back in whatever mode it was. All of it goes through
// hooks/usePlaceCall, the same path the chat thread uses.
//
// Still outstanding, and worth knowing before blaming this screen: _ice_servers()
// returns Google STUN only, with no TURN, so calls between two mobile networks
// still fail to connect. That is a server-side gap, not a UI one.
//
// Two server behaviours worth knowing while reading this:
//   • a cron trims chat.call rows older than 60 days, so history is not "all time"
//   • history is written only when the CALLER's client reports the call ended, so
//     a killed app leaves no row at all
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, SectionList,
  RefreshControl, Alert, ScrollView, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SHADOW, RADIUS, SPACING, TOP, themed } from '../theme';
import {
  Screen, Loader, EmptyState, Avatar, PopupModal, ConfirmDialog, Switch, emptyWrap,
} from '../components/ui';
import { TABBAR_SPACE } from '../components/chat/BottomTabs';
import * as chat from '../services/chat';
import usePlaceCall from '../hooks/usePlaceCall';
import DialPad from '../components/chat/DialPad';
import { lockSwipe, unlockSwipe } from '../components/chat/SwipeTabs';
import { createLogger } from '../api/logger';

const log = createLogger('Calls');

const DAYS = 14;          // how far ahead you can schedule
const MINUTE_STEP = 5;

function duration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

// A scheduled call reads better with the day AND the time, since it is future.
function whenFull(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const t = new Date(now); t.setDate(now.getDate() + 1);
  if (d.toDateString() === t.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

function dayLabel(offset) {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

// Height of one row in the favourites dialog. Fixed, because the drag handle
// converts distance moved into places moved by dividing by it — which avoids
// measuring anything, and avoids a drag-and-drop dependency.
const FAV_ROW_H = 56;

// A row in the favourites dialog. Tapping anywhere toggles; the ☰ handle on the
// left drags to reorder, and only appears once the person is actually a
// favourite — there is nothing to order otherwise.
function FavPickRow({ person, picked, onToggle, onMove }) {
  const drag = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderRelease: (_e, g) => {
        const places = Math.round(g.dy / FAV_ROW_H);
        if (places) onMove(places);
      },
    }),
  ).current;

  return (
    <TouchableOpacity style={s.pickRow} activeOpacity={0.75} onPress={onToggle}>
      {picked ? (
        <View style={s.dragHandle} {...drag.panHandlers}>
          <Ionicons name="reorder-two-outline" size={20} color={COLORS.slate400} />
        </View>
      ) : (
        <View style={s.dragHandle} />
      )}
      <Avatar name={person.name} uri={person.avatarUrl} size={38} />
      <View style={{ flex: 1 }}>
        <Text style={s.pickName} numberOfLines={1}>{person.name}</Text>
        {!!person.mobile && <Text style={s.pickSub} numberOfLines={1}>{person.mobile}</Text>}
      </View>
      <Ionicons
        name={picked ? 'checkmark-circle' : 'ellipse-outline'}
        size={22}
        color={picked ? COLORS.primary : COLORS.slate400}
      />
    </TouchableOpacity>
  );
}

// One of the three top actions: Schedule, Keypad, Favourites.
function ActionChip({ icon, label, onPress }) {
  return (
    <TouchableOpacity style={s.actChip} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name={icon} size={17} color={COLORS.primary} />
      <Text style={s.actChipTxt}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function CallsScreen({ onOpenChat }) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // No conversation is passed: every row targets a different contact, so each
  // button supplies its own target. Buttons are never hidden for a missing
  // WebRTC module — placeCall explains that instead of silently disappearing.
  const { placeCall, callErr, clearCallErr } = usePlaceCall();
  const [padOpen, setPadOpen] = useState(false);
  const [favOpen, setFavOpen] = useState(false);   // the add-favourites picker
  const [favPick, setFavPick] = useState({});      // userId → selected
  const [favOrder, setFavOrder] = useState([]);    // userIds, in arranged order
  const [people, setPeople] = useState([]);        // contacts, fetched once
  const [busyFav, setBusyFav] = useState(false);
  const [confirmUnfav, setConfirmUnfav] = useState(null);

  // ── schedule dialog ────────────────────────────────────────────────────────
  const [schedOpen, setSchedOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [dayOffset, setDayOffset] = useState(0);
  const [hour, setHour] = useState(() => (new Date().getHours() + 1) % 24);
  const [minute, setMinute] = useState(0);
  const [video, setVideo] = useState(false);
  const [withConv, setWithConv] = useState(0);   // optional 1:1 to attach
  const [directs, setDirects] = useState([]);
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await chat.fetchCalls()); }
    catch (e) { log.warn('load failed', e?.message); setError(e?.message || 'Could not load calls.'); }
  }, []);

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false); })(); }, [load]);

  // Only fetched when the dialog opens — the tab itself does not need them.
  const openSchedule = useCallback(async () => {
    setTitle(''); setDayOffset(0); setMinute(0); setVideo(false); setWithConv(0);
    setHour((new Date().getHours() + 1) % 24);
    setSchedOpen(true);
    try {
      const { conversations } = await chat.fetchConversations('all');
      setDirects((conversations || []).filter((c) => !c.isGroup));
    } catch (e) {
      log.warn('contacts failed', e?.message);
    }
  }, []);

  const submitSchedule = useCallback(async () => {
    const t = title.trim();
    if (!t) return;
    // Built in LOCAL time, then toISOString() converts to UTC — which is what the
    // server stores. Sending local time would fire the reminder at the wrong hour.
    const at = new Date();
    at.setDate(at.getDate() + dayOffset);
    at.setHours(hour, minute, 0, 0);
    if (at.getTime() < Date.now()) {
      Alert.alert('Pick a future time', 'That time has already passed today.');
      return;
    }
    setSaving(true);
    try {
      await chat.scheduleCall({ title: t, when: at, video, conversationId: withConv });
      setSchedOpen(false);
      await load();
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Could not schedule the call.');
    } finally {
      setSaving(false);
    }
  }, [title, dayOffset, hour, minute, video, withConv, load]);

  const doCancel = useCallback(async (item) => {
    setConfirmCancel(null);
    try { await chat.cancelScheduledCall(item.id); await load(); }
    catch (e) { Alert.alert('Failed', e?.message || 'Could not cancel.'); }
  }, [load]);

  const unfavourite = useCallback(async (item) => {
    try { await chat.favouriteConversation(item.conversationId, false); await load(); }
    catch (e) { Alert.alert('Failed', e?.message || 'Please try again.'); }
  }, [load]);

  // Favourites are their own strip above the list (see below), so the sections
  // here are just the history — Upcoming, then Recent.
  const sections = [];
  if (data?.upcoming?.length) sections.push({ title: 'Upcoming', data: data.upcoming, kind: 'upcoming' });
  if (data?.recent?.length) sections.push({ title: 'Recent', data: data.recent, kind: 'recent' });

  // Manage favourites, WhatsApp-style. The dialog is not "add" only: whoever is
  // already a favourite opens ticked, and un-ticking removes them. It also owns
  // the order — drag a row by its handle and that ordering is what the strip
  // above shows, on this device and on the web.
  //
  // "Favourite" is a flag on a CONVERSATION, not on a user, so each pick has to
  // be resolved to its 1:1 first. openDirect is get-or-create, so favouriting
  // someone you have never messaged works and leaves exactly one chat behind.
  const openFavPicker = useCallback(async () => {
    // Current favourites first, in their saved order, pre-ticked.
    const favs = data?.favorites || [];
    const picked = {};
    favs.forEach((f) => { if (f.userId) picked[f.userId] = true; });
    setFavPick(picked);
    setFavOrder(favs.map((f) => f.userId).filter(Boolean));
    setFavOpen(true);
    try {
      const list = await chat.fetchContacts('');
      setPeople(list || []);
    } catch (e) { log.warn('contacts failed', e?.message); }
  }, [data]);

  const saveFavourites = useCallback(async () => {
    const wanted = Object.keys(favPick).filter((k) => favPick[k]).map(Number);
    const before = (data?.favorites || []);
    setFavOpen(false);
    setBusyFav(true);
    try {
      // Removals first: anything that was a favourite and is no longer ticked.
      for (const f of before) {
        if (f.userId && !wanted.includes(f.userId)) {
          await chat.favouriteConversation(f.conversationId, false);
        }
      }
      // Additions, resolving each person to their 1:1.
      const convByUser = {};
      before.forEach((f) => { if (f.userId) convByUser[f.userId] = f.conversationId; });
      for (const uid of wanted) {
        if (convByUser[uid]) continue;
        const conv = await chat.openDirect(uid);
        convByUser[uid] = conv.id;
        await chat.favouriteConversation(conv.id, true);
      }
      // Then the order, in the arrangement shown in the dialog. Anything ticked
      // but never dragged goes on the end.
      const ordered = [
        ...favOrder.filter((uid) => wanted.includes(uid)),
        ...wanted.filter((uid) => !favOrder.includes(uid)),
      ].map((uid) => convByUser[uid]).filter(Boolean);
      if (ordered.length) await chat.setFavouritesOrder(ordered);
      await load();
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Could not save favourites.');
      load();
    } finally {
      setBusyFav(false);
    }
  }, [favPick, favOrder, data, load]);

  // Contacts by user id, with the current favourites folded in. A favourite is
  // not guaranteed to appear in /chat/contacts (the directory can be filtered),
  // and a row that vanished from the dialog would look like it had been removed
  // — so the favourite's own name/avatar is the fallback.
  const byId = {};
  (data?.favorites || []).forEach((f) => {
    if (f.userId) byId[f.userId] = { id: f.userId, name: f.name, avatarUrl: f.avatarUrl, mobile: '' };
  });
  people.forEach((p) => { byId[p.id] = p; });

  // Toggling in the dialog also maintains the order list, so a newly ticked
  // person is immediately draggable rather than appearing only after saving.
  const toggleFav = useCallback((uid) => {
    setFavPick((m) => {
      const next = { ...m, [uid]: !m[uid] };
      setFavOrder((ord) => (next[uid]
        ? (ord.includes(uid) ? ord : [...ord, uid])
        : ord.filter((x) => x !== uid)));
      return next;
    });
  }, []);

  // Drag-reorder: the handle reports how far it moved, which divided by the row
  // height is how many places to travel. Rows are a fixed height here, so this
  // needs no measurement and no extra dependency.
  const moveFav = useCallback((uid, delta) => {
    setFavOrder((ord) => {
      const from = ord.indexOf(uid);
      if (from < 0) return ord;
      const to = Math.max(0, Math.min(ord.length - 1, from + delta));
      if (to === from) return ord;
      const next = ord.slice();
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  }, []);

  // Keypad → contact → conversation → ring. openDirect is get-or-create, so
  // calling the same person twice never leaves a duplicate chat behind.
  const callContact = useCallback(async (contact, video) => {
    setPadOpen(false);
    try {
      const conv = await chat.openDirect(contact.id);
      placeCall(video, { ...conv, name: conv.title || contact.name });
    } catch (e) {
      Alert.alert('Could not call', e?.message || 'Please try again.');
    }
  }, [placeCall]);

  const renderRow = ({ item, section }) => {
    if (section.kind === 'upcoming') {
      return (
        <TouchableOpacity
          style={s.row}
          activeOpacity={item.conversationId ? 0.75 : 1}
          // Rows used to have no tap action at all.
          onPress={() => item.conversationId && onOpenChat?.(item.conversationId, item.title)}
        >
          <View style={[s.icon, { backgroundColor: COLORS.greenBg }]}>
            <Ionicons name="calendar" size={19} color={COLORS.green} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.name} numberOfLines={1}>{item.title || 'Scheduled call'}</Text>
            <Text style={s.meta} numberOfLines={1}>
              {whenFull(item.when)} · {item.video ? 'Video' : 'Voice'}
              {item.organizer ? ` · ${item.organizer}` : ''}
            </Text>
          </View>
          {/* Cancel is organiser-only: the server silently ignores anyone else,
              so the button has to be hidden rather than fail quietly. */}
          {item.mine && (
            <TouchableOpacity
              onPress={() => setConfirmCancel(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close-circle-outline" size={21} color={COLORS.red} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      );
    }
    if (section.kind === 'fav') {
      return (
        <TouchableOpacity style={s.row} activeOpacity={0.75} onPress={() => onOpenChat?.(item.conversationId, item.name)}>
          <Avatar name={item.name} uri={item.avatarUrl} size={44} />
          <Text style={[s.name, { flex: 1 }]} numberOfLines={1}>{item.name}</Text>
          <TouchableOpacity onPress={() => unfavourite(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="heart" size={20} color={COLORS.red} />
          </TouchableOpacity>
          {/* Voice AND video, like the web's two quick-call buttons. These used
              to be one button showing "Calling not available yet" — true when
              written, wrong since the app gained WebRTC. */}
          {/* Always shown. A build without the WebRTC module gets an explanation
              from placeCall rather than a row that quietly loses its buttons. */}
          <TouchableOpacity
            onPress={() => placeCall(false, item)}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          >
            <Ionicons name="call-outline" size={21} color={COLORS.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => placeCall(true, item)}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          >
            <Ionicons name="videocam-outline" size={21} color={COLORS.primary} />
          </TouchableOpacity>
        </TouchableOpacity>
      );
    }
    // recent
    const arrow = item.missed ? 'call' : item.outgoing ? 'arrow-up-outline' : 'arrow-down-outline';
    const tint = item.missed ? COLORS.red : item.outgoing ? COLORS.slate500 : COLORS.green;
    return (
      <TouchableOpacity style={s.row} activeOpacity={0.75} onPress={() => onOpenChat?.(item.conversationId, item.name)}>
        <Avatar name={item.name} uri={item.avatarUrl} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={[s.name, item.missed && { color: COLORS.red }]} numberOfLines={1}>{item.name}</Text>
          <View style={s.metaRow}>
            <Ionicons name={arrow} size={13} color={tint} />
            <Text style={s.meta} numberOfLines={1}>
              {item.missed ? 'Missed' : duration(item.duration) || 'Call'} · {when(item.created)}
            </Text>
          </View>
        </View>
        {/* Call back, in the same mode as the original call. This glyph was a
            bare <Ionicons> with no onPress — it looked like a button and did
            nothing. */}
        <TouchableOpacity
          onPress={() => placeCall(!!item.video, item)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name={item.video ? 'videocam-outline' : 'call-outline'} size={20} color={COLORS.primary} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <Screen>
      <View style={[s.header, { paddingTop: TOP }]}>
        <Text style={s.headerTitle}>Calls</Text>
      </View>

      {/* Schedule · Keypad · Favourites, above the history — WhatsApp puts the
          actions where your thumb already is and lets the log scroll under. */}
      <View style={s.actions}>
        <ActionChip icon="calendar-outline" label="Schedule" onPress={openSchedule} />
        <ActionChip icon="keypad-outline" label="Keypad" onPress={() => setPadOpen(true)} />
        <ActionChip icon="heart-outline" label="Favourites" onPress={openFavPicker} />
      </View>

      {/* The favourites themselves, as a strip right under the actions. Tap to
          call, long-press to remove — the same shortlist WhatsApp keeps at the
          top of its Calls tab. */}
      {!!data?.favorites?.length && (
        <View style={s.favWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.favStrip}
            onTouchStart={lockSwipe}
            onTouchEnd={unlockSwipe}
            onTouchCancel={unlockSwipe}
          >
            {data.favorites.map((f) => (
              <TouchableOpacity
                key={f.conversationId}
                style={s.fav}
                activeOpacity={0.75}
                onPress={() => placeCall(false, f)}
                onLongPress={() => setConfirmUnfav(f)}
                delayLongPress={300}
              >
                <Avatar name={f.name} uri={f.avatarUrl} size={50} />
                <Text style={s.favName} numberOfLines={1}>{f.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.fav} activeOpacity={0.75} onPress={openFavPicker}>
              <View style={s.favAdd}>
                <Ionicons name="add" size={24} color={COLORS.primary} />
              </View>
              <Text style={s.favName} numberOfLines={1}>Add</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {loading ? <Loader /> : error ? (
        <View style={emptyWrap}>
          <EmptyState icon="alert-circle-outline" tone="error" title={error} onRetry={load} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item, i) => `${item.id ?? item.conversationId}-${i}`}
          renderItem={renderRow}
          renderSectionHeader={({ section }) => <Text style={s.section}>{section.title}</Text>}
          stickySectionHeadersEnabled={false}
          // Reserve room for the floating tab bar, which overlays this list.
          contentContainerStyle={sections.length ? { paddingBottom: TABBAR_SPACE + insets.bottom } : emptyWrap}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
              tintColor={COLORS.primary} colors={[COLORS.primary]} progressBackgroundColor={COLORS.card}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="call-outline"
              title="No calls yet"
              sub="Add a favourite for one-tap calling, use Keypad to find someone by number, or schedule one for later."
            />
          }
        />
      )}

      {/* Schedule — no native date picker in this build, so day/hour/minute are
          horizontal scrollers. Adding @react-native-community/datetimepicker
          would need the same dev-client rebuild this whole screen works around. */}
      <PopupModal
        visible={schedOpen}
        onClose={() => setSchedOpen(false)}
        title="Schedule a call"
        subtitle="Everyone in the chat sees it under Scheduled."
      >
        <ScrollView style={{ maxHeight: 400 }} keyboardShouldPersistTaps="handled">
          <View style={s.dlgBody}>
            <Text style={s.label}>Title</Text>
            <TextInput
              style={s.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Weekly sync"
              placeholderTextColor={COLORS.faint}
              maxLength={120}
            />

            <Text style={s.label}>Day</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {Array.from({ length: DAYS }, (_, i) => i).map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[s.chip, dayOffset === d && s.chipOn]}
                  onPress={() => setDayOffset(d)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.chipTxt, dayOffset === d && s.chipTxtOn]}>{dayLabel(d)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={s.label}>Time</Text>
            <View style={s.timeRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                  <TouchableOpacity
                    key={h}
                    style={[s.num, hour === h && s.numOn]}
                    onPress={() => setHour(h)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.numTxt, hour === h && s.numTxtOn]}>{String(h).padStart(2, '0')}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={s.colon}>:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                {Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[s.num, minute === m && s.numOn]}
                    onPress={() => setMinute(m)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.numTxt, minute === m && s.numTxtOn]}>{String(m).padStart(2, '0')}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {!!directs.length && (
              <>
                <Text style={s.label}>With (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {directs.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={[s.who, withConv === c.id && s.whoOn]}
                      onPress={() => setWithConv(withConv === c.id ? 0 : c.id)}
                      activeOpacity={0.8}
                    >
                      <Avatar name={c.title} uri={c.avatarUrl} size={38} />
                      <Text style={s.whoTxt} numberOfLines={1}>{c.title}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            <View style={s.videoRow}>
              <Ionicons name="videocam-outline" size={19} color={COLORS.primary} />
              <Text style={[s.label, { flex: 1, marginTop: 0 }]}>Video call</Text>
              <Switch value={video} onValueChange={setVideo} />
            </View>
          </View>
        </ScrollView>
        <View style={s.dlgFoot}>
          <TouchableOpacity
            style={[s.primaryBtn, (!title.trim() || saving) && { backgroundColor: COLORS.slate400 }]}
            disabled={!title.trim() || saving}
            onPress={submitSchedule}
            activeOpacity={0.85}
          >
            <Text style={s.primaryTxt}>{saving ? 'Scheduling…' : 'Schedule'}</Text>
          </TouchableOpacity>
        </View>
      </PopupModal>

      <ConfirmDialog
        visible={!!confirmCancel}
        icon="calendar-outline"
        title="Cancel this call?"
        message={confirmCancel?.title
          ? `“${confirmCancel.title}” will be removed for everyone invited.`
          : 'It will be removed for everyone invited.'}
        actions={[{
          key: 'cancel', label: 'Cancel call', tone: 'danger',
          onPress: () => doCancel(confirmCancel),
        }]}
        cancelLabel="Keep it"
        onCancel={() => setConfirmCancel(null)}
      />

      {/* Add favourites — multi-select, like WhatsApp's "Add favourite". */}
      <PopupModal
        visible={favOpen}
        onClose={() => { setFavOpen(false); setFavPick({}); }}
        title="Favourites"
        subtitle="Tick to add, untick to remove. Drag ☰ to arrange the order."
      >
        <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
          {!people.length && <Text style={s.favNone}>Loading contacts…</Text>}
          {/* Ticked people first, in their arranged order and draggable, then
              everyone else. Putting them on top is what makes reordering make
              sense — you are arranging a shortlist, not scrolling a directory. */}
          {favOrder.map((uid) => {
            const p = byId[uid];
            if (!p) return null;
            return (
              <FavPickRow
                key={`fav-${uid}`}
                person={p}
                picked
                onToggle={() => toggleFav(uid)}
                onMove={(places) => moveFav(uid, places)}
              />
            );
          })}
          {favOrder.length > 0 && people.some((p) => !favPick[p.id]) && (
            <Text style={s.pickDivider}>All contacts</Text>
          )}
          {people.filter((p) => !favPick[p.id]).map((p) => (
            <FavPickRow
              key={p.id}
              person={p}
              picked={false}
              onToggle={() => toggleFav(p.id)}
              onMove={() => {}}
            />
          ))}
        </ScrollView>
        <TouchableOpacity
          style={[s.favSave, busyFav && { opacity: 0.6 }]}
          onPress={saveFavourites}
          activeOpacity={0.85}
          disabled={busyFav}
        >
          <Text style={s.favSaveTxt}>
            {busyFav ? 'Saving…' : `Save${favOrder.length ? ` (${favOrder.length})` : ''}`}
          </Text>
        </TouchableOpacity>
      </PopupModal>

      <ConfirmDialog
        visible={!!confirmUnfav}
        icon="heart-dislike-outline"
        title="Remove favourite?"
        message={confirmUnfav ? `${confirmUnfav.name} will no longer show at the top.` : ''}
        actions={[{
          key: 'unfav', label: 'Remove', tone: 'danger',
          onPress: () => { const f = confirmUnfav; setConfirmUnfav(null); unfavourite(f); },
        }]}
        onCancel={() => setConfirmUnfav(null)}
      />

      <DialPad
        visible={padOpen}
        onClose={() => setPadOpen(false)}
        onCall={callContact}
      />

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
    </Screen>
  );
}

const s = themed((C) => ({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md,
  },
  headerTitle: { fontSize: 20, fontWeight: '900', color: C.navy },

  // The three top actions.
  actions: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md,
  },
  // NOT named `chip` — the schedule dialog further down already owns that key,
  // and a duplicate silently loses to whichever is declared last.
  actChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: C.tintBg, borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md, paddingVertical: 9,
  },
  actChipTxt: { fontSize: 12.5, fontWeight: '800', color: C.primary },

  // Favourites strip.
  favWrap: { paddingBottom: SPACING.md },
  favStrip: { paddingHorizontal: SPACING.xl, gap: SPACING.lg },
  fav: { alignItems: 'center', width: 62 },
  favAdd: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.tintBg, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed',
  },
  favName: { fontSize: 11, color: C.slate500, marginTop: 4, textAlign: 'center' },
  favNone: { fontSize: 13, color: C.slate500, textAlign: 'center', paddingVertical: SPACING.lg },

  // Add-favourites picker.
  // Fixed height — the drag handle divides distance by it to get places moved.
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    height: FAV_ROW_H, paddingHorizontal: SPACING.lg,
  },
  // Always present, even when empty, so ticking someone does not shift the row.
  dragHandle: { width: 24, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  pickName: { fontSize: 14.5, fontWeight: '700', color: C.ink },
  pickSub: { fontSize: 11.5, color: C.slate500 },
  pickDivider: {
    fontSize: 11, fontWeight: '900', color: C.muted, letterSpacing: 0.7,
    textTransform: 'uppercase', paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: 4,
  },
  favSave: {
    marginTop: SPACING.md, marginHorizontal: SPACING.xl, borderRadius: RADIUS.md, backgroundColor: C.primary,
    paddingVertical: 11, alignItems: 'center',
  },
  favSaveTxt: { fontSize: 14.5, fontWeight: '800', color: C.onPrimary },
  section: {
    fontSize: 12, fontWeight: '900', color: C.muted, letterSpacing: 0.7,
    paddingHorizontal: SPACING.screen, paddingTop: SPACING.screen,
    paddingBottom: SPACING.xs, textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15.5, fontWeight: '800', color: C.slate900 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  meta: { fontSize: 12.5, color: C.slate500 },

  dlgBody: { paddingHorizontal: SPACING.xl, paddingTop: SPACING.sm },
  dlgFoot: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md },
  label: {
    fontSize: 12.5, fontWeight: '800', color: C.muted,
    marginTop: SPACING.screen, marginBottom: SPACING.xs,
  },
  input: {
    backgroundColor: C.slate50, borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.line,
    paddingHorizontal: SPACING.screen, height: 46, fontSize: 15, color: C.ink,
  },
  chip: {
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill,
    backgroundColor: C.slate50, borderWidth: 1, borderColor: C.line, marginRight: SPACING.sm,
  },
  chipOn: { backgroundColor: C.tintBg, borderColor: C.primary },
  chipTxt: { fontSize: 13, fontWeight: '700', color: C.slate500 },
  chipTxtOn: { color: C.primary, fontWeight: '800' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  colon: { fontSize: 18, fontWeight: '900', color: C.muted },
  num: {
    minWidth: 42, alignItems: 'center', paddingVertical: SPACING.sm, borderRadius: RADIUS.md,
    backgroundColor: C.slate50, borderWidth: 1, borderColor: C.line, marginRight: 6,
  },
  numOn: { backgroundColor: C.tintBg, borderColor: C.primary },
  numTxt: { fontSize: 15, fontWeight: '700', color: C.slate500 },
  numTxtOn: { color: C.primary, fontWeight: '900' },
  who: { alignItems: 'center', width: 64, marginRight: SPACING.sm, gap: 4, paddingVertical: 4 },
  whoOn: { backgroundColor: C.tintBg, borderRadius: RADIUS.md },
  whoTxt: { fontSize: 10.5, color: C.slate500, fontWeight: '700' },
  videoRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    marginTop: SPACING.screen, paddingTop: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line,
  },
  primaryBtn: {
    height: 50, borderRadius: RADIUS.lg, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: SPACING.screen,
  },
  primaryTxt: { color: C.onPrimary, fontSize: 15.5, fontWeight: '800' },
}));
