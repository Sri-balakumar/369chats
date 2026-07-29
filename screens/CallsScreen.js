// CALLS — history, favourites and scheduled calls.
//
// Read-only by design right now. /chat/calls returns the log the server keeps,
// but PLACING a call needs WebRTC (react-native-webrtc, a native module the app
// does not carry) plus a TURN server, which is not configured on this deployment
// — _ice_servers() returns Google STUN only. Rather than show call buttons that
// fail on mobile data, the screen says what is missing when you tap one.
//
// Two server behaviours worth knowing while reading this:
//   • a cron trims chat.call rows older than 60 days, so history is not "all time"
//   • history is written only when the CALLER's client reports the call ended, so
//     a killed app leaves no row at all
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SectionList, RefreshControl, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SHADOW, RADIUS, SPACING, TOP, themed } from '../theme';
import { Screen, Loader, EmptyState, Avatar, emptyWrap } from '../components/ui';
import { TABBAR_SPACE } from '../components/chat/BottomTabs';
import * as chat from '../services/chat';
import { createLogger } from '../api/logger';

const log = createLogger('Calls');

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

export default function CallsScreen({ onOpenChat }) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await chat.fetchCalls()); }
    catch (e) { log.warn('load failed', e?.message); setError(e?.message || 'Could not load calls.'); }
  }, []);

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false); })(); }, [load]);

  const notYet = () => Alert.alert(
    'Calling not available yet',
    'Voice and video calling need the WebRTC module in the app build, and a TURN server configured on the Odoo side. Meeting links work today — open a chat and use “Start a meeting”.',
  );

  const sections = [];
  if (data?.upcoming?.length) sections.push({ title: 'Scheduled', data: data.upcoming, kind: 'upcoming' });
  if (data?.favorites?.length) sections.push({ title: 'Favourites', data: data.favorites, kind: 'fav' });
  if (data?.recent?.length) sections.push({ title: 'Recent', data: data.recent, kind: 'recent' });

  const renderRow = ({ item, section }) => {
    if (section.kind === 'upcoming') {
      return (
        <View style={s.row}>
          <View style={[s.icon, { backgroundColor: COLORS.greenBg }]}>
            <Ionicons name="calendar" size={19} color={COLORS.green} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.name} numberOfLines={1}>{item.title || 'Scheduled call'}</Text>
            <Text style={s.meta} numberOfLines={1}>
              {when(item.when)} · {item.video ? 'Video' : 'Voice'}
              {item.organizer ? ` · ${item.organizer}` : ''}
            </Text>
          </View>
        </View>
      );
    }
    if (section.kind === 'fav') {
      return (
        <TouchableOpacity style={s.row} activeOpacity={0.75} onPress={() => onOpenChat?.(item.conversationId, item.name)}>
          <Avatar name={item.name} uri={item.avatarUrl} size={44} />
          <Text style={[s.name, { flex: 1 }]} numberOfLines={1}>{item.name}</Text>
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
              sub="Call history appears here. Placing calls needs the WebRTC build."
            />
          }
        />
      )}
    </Screen>
  );
}

const s = themed((C) => ({
  header: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md },
  headerTitle: { fontSize: 20, fontWeight: '900', color: C.navy },
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
}));
