// AttachSheet — what the paperclip opens, shaped like WhatsApp's:
//
//   ── drag handle ──
//   [Gallery] [Camera] [Document] [Poll] …      ← source tiles
//   ▢ ▢ ▢ ▢ ▢ …                                 ← recent photos & videos
//
// Collapsed it shows one row of recent media; drag the handle up (or tap the
// chevron) and it grows into a full grid. Tapping a thumbnail sends it straight
// away — no trip through the system picker.
//
// Reading the device gallery needs expo-media-library; expo-image-picker can only
// *launch* the OS picker, never enumerate it. That is a native module, so the
// strip only appears in a dev build that includes it — the tiles above always
// work, and the strip degrades to a "grant access" prompt or nothing.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Modal, View, Text, Image, TouchableOpacity, TouchableWithoutFeedback,
  StyleSheet, FlatList, Dimensions, Animated, PanResponder, ActivityIndicator,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, RADIUS, SPACING, SCRIM } from '../../theme';
import { createLogger } from '../../api/logger';

const log = createLogger('AttachSheet');

const { width: SW, height: SH } = Dimensions.get('window');
const COLS = 3;
const GAP = 3;
const TILE = (SW - GAP * (COLS + 1)) / COLS;

const COLLAPSED = Math.min(430, SH * 0.52);
const EXPANDED = SH * 0.9;
const PAGE = 60;

function secs(ms) {
  const t = Math.round((ms || 0));
  const m = Math.floor(t / 60);
  return `${m}:${String(t % 60).padStart(2, '0')}`;
}

function SourceTile({ item, onPress }) {
  const Icon = item.lib === 'mc' ? MaterialCommunityIcons : Ionicons;
  return (
    <TouchableOpacity style={s.tile} onPress={onPress} activeOpacity={0.75}>
      <View style={[s.circle, { backgroundColor: item.bg }]}>
        <Icon name={item.icon} size={24} color={item.fg} />
      </View>
      <Text style={s.tileLabel} numberOfLines={1}>{item.label}</Text>
    </TouchableOpacity>
  );
}

export default function AttachSheet({ visible, onClose, items = [], onPickAsset }) {
  const insets = useSafeAreaInsets();
  const [assets, setAssets] = useState([]);
  const [perm, setPerm] = useState(null);     // null unknown | true | false
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [more, setMore] = useState(true);
  const [selecting, setSelecting] = useState(false);   // multi-select mode
  const [chosen, setChosen] = useState([]);

  const height = useRef(new Animated.Value(COLLAPSED)).current;

  const animateTo = useCallback((to) => {
    Animated.spring(height, {
      toValue: to, useNativeDriver: false, bounciness: 0, speed: 14,
    }).start();
  }, [height]);

  const setExpandedTo = useCallback((next) => {
    setExpanded(next);
    animateTo(next ? EXPANDED : COLLAPSED);
  }, [animateTo]);

  // Drag the handle: follow the finger, then settle to whichever end is nearer.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_e, g) => {
        const base = expandedRef.current ? EXPANDED : COLLAPSED;
        const next = Math.max(COLLAPSED * 0.6, Math.min(EXPANDED, base - g.dy));
        height.setValue(next);
      },
      onPanResponderRelease: (_e, g) => {
        const base = expandedRef.current ? EXPANDED : COLLAPSED;
        const next = base - g.dy;
        // A firm downward flick from collapsed closes the sheet entirely.
        if (!expandedRef.current && g.dy > 90) { onCloseRef.current?.(); return; }
        const goExpanded = next > (COLLAPSED + EXPANDED) / 2;
        setExpandedRef.current(goExpanded);
      },
    }),
  ).current;

  // PanResponder is created once, so it must read the latest values through refs.
  const expandedRef = useRef(expanded);
  const setExpandedRef = useRef(setExpandedTo);
  const onCloseRef = useRef(onClose);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);
  useEffect(() => { setExpandedRef.current = setExpandedTo; }, [setExpandedTo]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const loadAssets = useCallback(async (after = null) => {
    setLoading(true);
    try {
      const res = await MediaLibrary.getAssetsAsync({
        first: PAGE,
        ...(after ? { after } : {}),
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        sortBy: [MediaLibrary.SortBy.creationTime],
      });
      setAssets((prev) => (after ? [...prev, ...res.assets] : res.assets));
      setCursor(res.endCursor);
      setMore(res.hasNextPage);
    } catch (e) {
      log.warn('gallery read failed', e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Ask only when the sheet is actually opened — no permission prompt on launch.
  useEffect(() => {
    if (!visible) return;
    setExpanded(false);
    height.setValue(COLLAPSED);
    setSelecting(false);
    setChosen([]);
    (async () => {
      try {
        const r = await MediaLibrary.requestPermissionsAsync();
        setPerm(r.granted);
        if (r.granted) loadAssets(null);
      } catch (e) {
        log.warn('permission failed', e?.message);
        setPerm(false);
      }
    })();
  }, [visible, height, loadAssets]);

  // iOS hands back a ph:// reference; only getAssetInfoAsync yields a path that
  // can actually be read off disk. Android's file:// is already usable.
  const resolve = useCallback(async (asset) => {
    let uri = asset.uri;
    if (uri.startsWith('ph://')) {
      const info = await MediaLibrary.getAssetInfoAsync(asset);
      uri = info.localUri || uri;
    }
    return {
      uri,
      filename: asset.filename,
      isVideo: asset.mediaType === MediaLibrary.MediaType.video,
      duration: Math.round(asset.duration || 0),
      width: asset.width,
      height: asset.height,
    };
  }, []);

  const handOff = useCallback(async (assets) => {
    onClose?.();
    try { onPickAsset?.(await Promise.all(assets.map(resolve))); }
    catch (e) { log.warn('pick failed', e?.message); }
  }, [onClose, onPickAsset, resolve]);

  // Tap sends one straight through. Long-press starts multi-select — the same
  // gesture WhatsApp uses — after which tapping toggles instead of sending.
  const onAssetPress = useCallback((asset) => {
    if (!selecting) { handOff([asset]); return; }
    setChosen((prev) => (
      prev.some((a) => a.id === asset.id)
        ? prev.filter((a) => a.id !== asset.id)
        : [...prev, asset]
    ));
  }, [selecting, handOff]);

  const onAssetLongPress = useCallback((asset) => {
    setSelecting(true);
    setChosen([asset]);
  }, []);

  const renderAsset = ({ item }) => {
    const at = chosen.findIndex((a) => a.id === item.id);
    return (
      <TouchableOpacity
        style={s.assetTile}
        activeOpacity={0.8}
        onPress={() => onAssetPress(item)}
        onLongPress={() => onAssetLongPress(item)}
        delayLongPress={220}
      >
        <Image source={{ uri: item.uri }} style={s.assetImg} />
        {item.mediaType === MediaLibrary.MediaType.video && (
          <View style={s.assetVideo}>
            <Ionicons name="play" size={11} color="#fff" />
            <Text style={s.assetDur}>{secs(item.duration)}</Text>
          </View>
        )}
        {selecting && (
          <View style={[s.check, at >= 0 && s.checkOn]}>
            {at >= 0 && <Text style={s.checkTxt}>{at + 1}</Text>}
          </View>
        )}
        {at >= 0 && <View style={s.selOverlay} pointerEvents="none" />}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.scrim} />
      </TouchableWithoutFeedback>

      <Animated.View style={[s.sheet, { height, paddingBottom: insets.bottom }]}>
        <View {...pan.panHandlers} style={s.handleZone}>
          <View style={s.handle} />
        </View>

        <View style={s.tiles}>
          {items.filter(Boolean).map((it) => (
            <SourceTile key={it.key} item={it} onPress={() => { onClose?.(); it.onPress?.(); }} />
          ))}
        </View>

        <View style={s.recentHead}>
          <Text style={s.recentTitle}>
            {selecting ? `${chosen.length} selected` : 'Recent'}
          </Text>
          {selecting ? (
            <View style={s.selActions}>
              <TouchableOpacity onPress={() => { setSelecting(false); setChosen([]); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.selCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.selNext, !chosen.length && { backgroundColor: COLORS.slate400 }]}
                disabled={!chosen.length}
                onPress={() => handOff(chosen)}
              >
                <Text style={s.selNextTxt}>Next</Text>
                <Ionicons name="arrow-forward" size={14} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setExpandedTo(!expanded)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name={expanded ? 'chevron-down' : 'chevron-up'} size={20} color={COLORS.slate500} />
            </TouchableOpacity>
          )}
        </View>
        {!selecting && (
          <Text style={s.hint}>Tap to send · hold to pick several</Text>
        )}

        {perm === false ? (
          <Text style={s.note}>
            Allow photo access to pick from here — or use the Gallery button above.
          </Text>
        ) : loading && !assets.length ? (
          <ActivityIndicator style={{ marginTop: SPACING.xl }} color={COLORS.primary} />
        ) : (
          <FlatList
            data={assets}
            keyExtractor={(a) => a.id}
            renderItem={renderAsset}
            // Collapsed shows a single scrolling row; expanded becomes a grid.
            key={expanded ? 'grid' : 'row'}
            horizontal={!expanded}
            numColumns={expanded ? COLS : undefined}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ padding: GAP }}
            onEndReached={() => { if (more && !loading) loadAssets(cursor); }}
            onEndReachedThreshold={0.5}
            ListEmptyComponent={<Text style={s.note}>No photos or videos on this device.</Text>}
          />
        )}
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: SCRIM },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet,
    overflow: 'hidden',
  },
  handleZone: { alignItems: 'center', paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  handle: { width: 42, height: 4, borderRadius: 2, backgroundColor: '#D5DCE8' },

  tiles: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: SPACING.sm, paddingBottom: SPACING.md,
  },
  tile: { width: '25%', alignItems: 'center', marginBottom: SPACING.screen, gap: 6 },
  circle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 11.5, color: COLORS.slate500, fontWeight: '600' },

  recentHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.screen, paddingBottom: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
    paddingTop: SPACING.md,
  },
  recentTitle: {
    fontSize: 12, fontWeight: '900', color: COLORS.muted,
    letterSpacing: 0.7, textTransform: 'uppercase',
  },

  assetTile: {
    width: TILE, height: TILE, margin: GAP / 2,
    borderRadius: 4, overflow: 'hidden', backgroundColor: COLORS.slate100,
  },
  assetImg: { width: '100%', height: '100%' },
  assetVideo: {
    position: 'absolute', left: 4, bottom: 4, flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: RADIUS.sm, paddingHorizontal: 5, paddingVertical: 2,
  },
  assetDur: { color: '#fff', fontSize: 9.5, fontWeight: '700' },

  note: { fontSize: 13, color: COLORS.slate500, textAlign: 'center', padding: SPACING.xl, lineHeight: 19 },
  hint: {
    fontSize: 11, color: COLORS.faint, paddingHorizontal: SPACING.screen,
    paddingBottom: SPACING.sm,
  },

  selActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.lg },
  selCancel: { fontSize: 13, fontWeight: '700', color: COLORS.slate500 },
  selNext: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.pill,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  selNextTxt: { color: '#fff', fontSize: 13, fontWeight: '800' },

  // Numbered badge shows selection ORDER, which is the order they get sent in.
  check: {
    position: 'absolute', top: 5, right: 5,
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: COLORS.primary },
  checkTxt: { color: '#fff', fontSize: 11, fontWeight: '900' },
  selOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(30,64,175,0.28)' },
});
