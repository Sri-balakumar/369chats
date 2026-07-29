// MEDIA, LINKS AND DOCS — the gallery behind a chat's ⋮ menu.
//
// Scoped to one conversation when `conversation` is passed, otherwise across
// every chat. The server groups items by month itself (`month_label`, either
// 'This Month' or 'June 2026'), so the section headers come straight from the
// payload rather than being re-derived here.
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SectionList, Image, Dimensions, Linking, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SHADOW, RADIUS, SPACING, TOP, themed } from '../theme';
import { Screen, ChipRow, Loader, EmptyState, emptyWrap } from '../components/ui';
import MediaViewer from '../components/chat/MediaViewer';
import AuthImage from '../components/chat/AuthImage';
import openAttachment from '../utils/openAttachment';
import * as chat from '../services/chat';
import { createLogger } from '../api/logger';

const log = createLogger('ChatMedia');

const TABS = [
  { key: 'media', label: 'Media' },
  { key: 'docs', label: 'Docs' },
  { key: 'links', label: 'Links' },
];

const COLS = 3;
const GAP = 3;
const TILE = (Dimensions.get('window').width - GAP * (COLS + 1)) / COLS;

// Group a flat item list into SectionList sections, preserving server order.
function toSections(items) {
  const out = [];
  items.forEach((it) => {
    const label = it.monthLabel || '';
    const last = out[out.length - 1];
    if (last && last.title === label) last.data.push(it);
    else out.push({ title: label, data: [it] });
  });
  return out;
}

// SectionList renders one row at a time, so a grid means chunking each section's
// items into rows of COLS.
function chunk(list, size) {
  const rows = [];
  for (let i = 0; i < list.length; i += size) rows.push(list.slice(i, i + size));
  return rows;
}

export default function ChatMediaScreen({ conversation, onBack }) {
  // Edge-to-edge draws under the nav bar; reserve that space at the bottom.
  const insets = useSafeAreaInsets();
  const scoped = !!conversation?.id;
  const [tab, setTab] = useState('media');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewer, setViewer] = useState(null);

  const load = useCallback(async (t) => {
    setError(null);
    try {
      setItems(scoped
        ? await chat.fetchMediaList(conversation.id, t)
        : await chat.fetchAllMedia(t));
    } catch (e) {
      log.warn('load failed', e?.message);
      setError(e?.message || 'Could not load.');
    }
  }, [scoped, conversation]);

  useEffect(() => { (async () => { setLoading(true); await load(tab); setLoading(false); })(); }, [tab, load]);

  const openItem = async (it) => {
    if (tab === 'links') {
      Linking.openURL(it.url).catch(() => Alert.alert('Could not open', it.url));
      return;
    }
    // MediaViewer speaks the message shape, so adapt the gallery item to it.
    const asMsg = {
      id: it.id, kind: it.kind, mediaUrl: it.url, fileName: it.name,
      mimetype: '', body: '', authorName: it.author || '',
    };
    // Images preview in-app; everything else runs straight away in the OS handler.
    if (it.kind === 'image') { setViewer(asMsg); return; }
    try { await openAttachment(asMsg); }
    catch (e) { Alert.alert('Could not open', e?.message || 'The file could not be opened.'); }
  };

  const isGrid = tab === 'media';
  const sections = isGrid
    ? toSections(items).map((sec) => ({ ...sec, data: chunk(sec.data, COLS) }))
    : toSections(items);

  return (
    <Screen>
      <View style={[s.header, { paddingTop: TOP }]}>
        <TouchableOpacity onPress={onBack} style={s.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={COLORS.navy} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>
          {scoped ? conversation.title : 'All media'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ChipRow chips={TABS} value={tab} onChange={setTab} />

      {loading ? <Loader /> : error ? (
        <View style={emptyWrap}>
          <EmptyState icon="alert-circle-outline" tone="error" title={error} onRetry={() => load(tab)} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row, i) => (isGrid ? `r${i}-${row[0]?.id}` : String(row.id))}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={items.length ? { paddingBottom: 30 + insets.bottom } : emptyWrap}
          renderSectionHeader={({ section }) => (
            section.title ? <Text style={s.sectionHead}>{section.title}</Text> : null
          )}
          renderItem={({ item }) => (isGrid ? (
            <View style={s.gridRow}>
              {item.map((it) => (
                <TouchableOpacity key={it.id} style={s.tile} activeOpacity={0.85} onPress={() => openItem(it)}>
                  {/* Authenticated route — a plain <Image> renders blank here. */}
                  <AuthImage uri={it.url} id={it.id} style={s.tileImg} />
                  {it.kind === 'video' && (
                    <View style={s.playBadge}><Ionicons name="play" size={16} color={COLORS.onPrimary} /></View>
                  )}
                </TouchableOpacity>
              ))}
              {/* Keep the last row left-aligned instead of stretched. */}
              {item.length < COLS && Array.from({ length: COLS - item.length }).map((_, i) => (
                <View key={`pad${i}`} style={[s.tile, { backgroundColor: 'transparent' }]} />
              ))}
            </View>
          ) : (
            <TouchableOpacity style={s.listRow} activeOpacity={0.75} onPress={() => openItem(item)}>
              <View style={s.listIcon}>
                <Ionicons
                  name={tab === 'links' ? 'link' : item.kind === 'audio' ? 'musical-notes' : 'document-text'}
                  size={19} color={COLORS.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.listName} numberOfLines={2}>{item.name || item.url}</Text>
                {!!item.chat && <Text style={s.listMeta} numberOfLines={1}>{item.chat}</Text>}
              </View>
            </TouchableOpacity>
          ))}
          ListEmptyComponent={
            <EmptyState
              icon={tab === 'links' ? 'link-outline' : tab === 'docs' ? 'document-outline' : 'images-outline'}
              title={`No ${tab === 'media' ? 'photos or videos' : tab} yet`}
            />
          }
        />
      )}

      <MediaViewer visible={!!viewer} message={viewer} onClose={() => setViewer(null)} />
    </Screen>
  );
}

const s = themed((C) => ({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: SPACING.md,
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '900', color: C.navy },
  iconBtn: {
    width: 40, height: 40, borderRadius: RADIUS.lg, backgroundColor: COLORS.card,
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },

  sectionHead: {
    fontSize: 12, fontWeight: '900', color: C.muted, letterSpacing: 0.7,
    paddingHorizontal: SPACING.screen, paddingTop: SPACING.screen, paddingBottom: SPACING.sm,
    textTransform: 'uppercase',
  },

  gridRow: { flexDirection: 'row', gap: GAP, paddingHorizontal: GAP, marginBottom: GAP },
  tile: { width: TILE, height: TILE, borderRadius: 4, overflow: 'hidden', backgroundColor: C.slate100 },
  tileImg: { width: '100%', height: '100%' },
  playBadge: {
    position: 'absolute', alignSelf: 'center', top: '38%',
    width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },

  listRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  listIcon: {
    width: 40, height: 40, borderRadius: RADIUS.md, backgroundColor: COLORS.tintBg,
    alignItems: 'center', justifyContent: 'center',
  },
  listName: { fontSize: 14.5, fontWeight: '700', color: C.ink },
  listMeta: { fontSize: 12, color: C.slate500, marginTop: 2 },
}));
