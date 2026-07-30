// CALLS — history, favourites and scheduled calls.
//
// PLACING a call is still not possible, and needs more than the missing native
// module: ring events travel only on the Odoo bus, and services/chatRealtime.js
// is a poller that stops when backgrounded, so an incoming call would arrive
// late or not at all. It also needs a TURN server — _ice_servers() returns
// Google STUN only, so mobile-to-mobile fails on most carrier networks.
//
// Everything that does NOT need WebRTC works here: scheduling, cancelling,
// favourites and history are plain JSON routes.
//
// Two server behaviours worth knowing while reading this:
//   • a cron trims chat.call rows older than 60 days, so history is not "all time"
//   • history is written only when the CALLER's client reports the call ended, so
//     a killed app leaves no row at all
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, SectionList,
  RefreshControl, Alert, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SHADOW, RADIUS, SPACING, TOP, themed } from '../theme';
import {
  Screen, Loader, EmptyState, Avatar, PopupModal, ConfirmDialog, Switch, emptyWrap,
} from '../components/ui';
import { TABBAR_SPACE } from '../components/chat/BottomTabs';
import * as chat from '../services/chat';
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

export default function CallsScreen({ onOpenChat }) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

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

  const notYet = () => Alert.alert(
    'Calling not available yet',
    'Voice and video calling need the WebRTC module in the app build, a realtime connection for ringing, and a TURN server on the Odoo side. Meeting links work today — open a chat and use “Start a meeting”.',
  );

  const sections = [];
  if (data?.upcoming?.length) sections.push({ title: 'Scheduled', data: data.upcoming, kind: 'upcoming' });
  if (data?.favorites?.length) sections.push({ title: 'Favourites', data: data.favorites, kind: 'fav' });
  if (data?.recent?.length) sections.push({ title: 'Recent', data: data.recent, kind: 'recent' });

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
          <TouchableOpacity onPress={notYet} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="call-outline" size={21} color={COLORS.primary} />
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
        <Ionicons name={item.video ? 'videocam-outline' : 'call-outline'} size={20} color={COLORS.primary} />
      </TouchableOpacity>
    );
  };

  return (
    <Screen>
      <View style={[s.header, { paddingTop: TOP }]}>
        <Text style={s.headerTitle}>Calls</Text>
        <TouchableOpacity style={s.schedBtn} onPress={openSchedule} activeOpacity={0.85}>
          <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
          <Text style={s.schedBtnTxt}>Schedule</Text>
        </TouchableOpacity>
      </View>

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
              sub="Schedule one with the button above. Placing calls needs the WebRTC build."
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
    </Screen>
  );
}

const s = themed((C) => ({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md,
  },
  headerTitle: { fontSize: 20, fontWeight: '900', color: C.navy },
  schedBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.tintBg, borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.screen, paddingVertical: 7,
  },
  schedBtnTxt: { fontSize: 13, fontWeight: '800', color: C.primary },
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
