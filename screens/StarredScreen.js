// STARRED MESSAGES — everything you've starred, across every chat.
//
// /chat/starred_messages returns the normal message shape plus a
// `conversation_title`, so each row can say where it came from without a second
// lookup. Unstarring here removes the row immediately; the server echoes the
// updated message back, so nothing needs refetching.
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SHADOW, RADIUS, SPACING, TOP } from '../theme';
import { Screen, Loader, EmptyState, emptyWrap } from '../components/ui';
import MediaViewer from '../components/chat/MediaViewer';
import * as chat from '../services/chat';
import { createLogger } from '../api/logger';

const log = createLogger('Starred');

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

export default function StarredScreen({ onBack, onOpenChat }) {
  // Edge-to-edge draws under the nav bar; reserve that space at the bottom.
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [viewer, setViewer] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try { setRows(await chat.fetchStarred()); }
    catch (e) { log.warn('load failed', e?.message); setError(e?.message || 'Could not load.'); }
  }, []);

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false); })(); }, [load]);

  const unstar = async (m) => {
    // Optimistic: it is leaving this list either way.
    setRows((prev) => prev.filter((x) => x.id !== m.id));
    try { await chat.star(m.id, false); } catch (_) { load(); }
  };

  return (
    <Screen>
      <View style={[s.header, { paddingTop: TOP }]}>
        <TouchableOpacity onPress={onBack} style={s.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={COLORS.navy} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Starred messages</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? <Loader /> : error ? (
        <View style={emptyWrap}>
          <EmptyState icon="alert-circle-outline" tone="error" title={error} onRetry={load} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={rows.length ? { paddingBottom: 30 + insets.bottom } : emptyWrap}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.row}
              activeOpacity={0.8}
              onPress={() => (item.hasMedia ? setViewer(item) : onOpenChat?.(item.conversationId, item.id))}
            >
              <View style={s.rowTop}>
                <Ionicons name="chatbubble-outline" size={13} color={COLORS.primary} />
                <Text style={s.chatName} numberOfLines={1}>{item.conversationTitle}</Text>
                <Text style={s.when}>{when(item.created)}</Text>
                <TouchableOpacity onPress={() => unstar(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="star" size={17} color={COLORS.amber} />
                </TouchableOpacity>
              </View>
              <Text style={s.author}>{item.mine ? 'You' : item.authorName}</Text>
              <Text style={s.body} numberOfLines={3}>
                {item.deleted
                  ? 'This message was deleted'
                  : item.body || item.fileName || `[${item.kind}]`}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="star-outline"
              title="No starred messages"
              sub="Long-press any message and choose Star to keep it here."
            />
          }
        />
      )}

      <MediaViewer visible={!!viewer} message={viewer} onClose={() => setViewer(null)} />
    </Screen>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: SPACING.md,
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '900', color: COLORS.navy },
  iconBtn: {
    width: 40, height: 40, borderRadius: RADIUS.lg, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },

  row: {
    backgroundColor: '#fff', marginHorizontal: SPACING.screen, marginTop: SPACING.md,
    borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.line,
    padding: SPACING.screen, ...SHADOW,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  chatName: { flex: 1, fontSize: 12.5, fontWeight: '800', color: COLORS.primary },
  when: { fontSize: 11.5, color: COLORS.slate400, marginRight: SPACING.sm },
  author: { fontSize: 12.5, fontWeight: '700', color: COLORS.slate500, marginTop: SPACING.sm },
  body: { fontSize: 14.5, color: COLORS.ink, marginTop: 2, lineHeight: 20 },
});
