// SEARCH — in one chat, or across every chat.
//
// Both server routes are plain ILIKE on the message body: no ranking, no
// filename matching, and /chat/search_all needs at least 2 characters. Results
// carry the message id, which is what /chat/messages_around uses to open the
// thread at that point — search without jump-to-context is half a feature, so
// tapping a hit hands the id back to the caller.
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SHADOW, RADIUS, SPACING, TOP, themed } from '../theme';
import { Screen, EmptyState, emptyWrap } from '../components/ui';
import * as chat from '../services/chat';
import { createLogger } from '../api/logger';

const log = createLogger('ChatSearch');

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ChatSearchScreen({ conversation, onBack, onJump, onOpenChat }) {
  // Edge-to-edge draws under the nav bar; reserve that space at the bottom.
  const insets = useSafeAreaInsets();
  // conversation present → scoped to that thread; absent → global.
  const scoped = !!conversation?.id;
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounce = useRef(null);

  const run = useCallback(async (q) => {
    const term = q.trim();
    // The global route rejects a single character outright.
    if (!term || (!scoped && term.length < 2)) { setRows([]); setSearched(false); return; }
    setBusy(true);
    try {
      if (scoped) {
        const msgs = await chat.searchMessages(conversation.id, term);
        setRows(msgs.map((m) => ({
          key: `m${m.id}`, messageId: m.id, conversationId: conversation.id,
          title: m.authorName, snippet: m.body, created: m.created,
        })));
      } else {
        const hits = await chat.searchAll(term);
        setRows(hits.map((h) => ({
          key: `g${h.messageId}`, messageId: h.messageId, conversationId: h.conversationId,
          title: h.conversationTitle, snippet: h.snippet, created: h.created, author: h.author,
        })));
      }
      setSearched(true);
    } catch (e) {
      log.warn('search failed', e?.message);
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, [scoped, conversation]);

  const onQuery = (t) => {
    setQuery(t);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => run(t), 350);
  };

  return (
    <Screen>
      <View style={[s.header, { paddingTop: TOP }]}>
        <TouchableOpacity onPress={onBack} style={s.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={COLORS.navy} />
        </TouchableOpacity>
        <View style={s.searchWrap}>
          <Ionicons name="search" size={17} color={COLORS.faint} />
          <TextInput
            style={s.search} value={query} onChangeText={onQuery} autoFocus
            placeholder={scoped ? `Search in ${conversation.title}` : 'Search all messages'}
            placeholderTextColor={COLORS.faint} returnKeyType="search"
            onSubmitEditing={() => run(query)}
          />
          {busy && <ActivityIndicator size="small" color={COLORS.primary} />}
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={rows.length ? { paddingBottom: 30 + insets.bottom } : emptyWrap}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.row}
            activeOpacity={0.75}
            onPress={() => (scoped
              ? onJump?.(item.messageId)
              : onOpenChat?.(item.conversationId, item.messageId))}
          >
            <View style={s.rowTop}>
              <Text style={s.rowTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={s.rowWhen}>{when(item.created)}</Text>
            </View>
            <Text style={s.rowSnippet} numberOfLines={2}>
              {item.author ? `${item.author}: ` : ''}{item.snippet}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="search-outline"
            title={
              !query.trim() ? 'Search messages'
                : (!scoped && query.trim().length < 2) ? 'Type at least 2 characters'
                  : searched ? 'No matches' : 'Searching…'
            }
            sub={!query.trim() ? (scoped ? 'Find anything said in this chat.' : 'Looks across every chat you are in.') : undefined}
          />
        }
      />
    </Screen>
  );
}

const s = themed((C) => ({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    paddingHorizontal: SPACING.md, paddingBottom: SPACING.md,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: RADIUS.lg, backgroundColor: COLORS.card,
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },
  searchWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.card, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: C.line,
    paddingHorizontal: SPACING.lg, height: 42,
  },
  search: { flex: 1, fontSize: 14.5, color: C.ink, paddingVertical: 0 },

  row: {
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { flex: 1, fontSize: 14.5, fontWeight: '800', color: C.navy },
  rowWhen: { fontSize: 11.5, color: C.slate400 },
  rowSnippet: { fontSize: 13.5, color: C.slate500, marginTop: 3 },
}));
