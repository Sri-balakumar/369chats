// MediaPreview — the review tray you get after picking photos/videos, matching
// the module's web client (X · "1 / N" · View once · caption · thumb strip) and
// adding the two options it lacks: CROP and HD.
//
// Every item keeps its ORIGINAL uri. Crop and quality are re-derived from that
// original each time, never from the previous render — otherwise switching
// Standard → HD would upscale an already-compressed image, and re-cropping would
// crop a crop.
//
// Videos are passed through untouched: expo-image-manipulator only handles
// stills, and transcoding video needs a native encoder this project doesn't carry.
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Modal, View, Text, Image, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, Dimensions, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, RADIUS, SPACING, themed } from '../../theme';
import CropEditor from './CropEditor';
import useKeyboardHeight from '../../utils/useKeyboardHeight';
import { createLogger } from '../../api/logger';

const log = createLogger('MediaPreview');

const { width: SW, height: SH } = Dimensions.get('window');

// Standard mirrors the web client's 1280/0.7. HD keeps far more detail at the
// cost of a much larger base64 body — the server caps images at 10 MB.
const QUALITY = {
  standard: { maxDim: 1280, compress: 0.7, label: 'Standard' },
  hd: { maxDim: 2560, compress: 0.92, label: 'HD' },
};

const CROPS = [
  { key: 'original', label: 'Original', ratio: null },
  { key: 'square', label: '1:1', ratio: 1 },
  { key: 'portrait', label: '4:5', ratio: 4 / 5 },
  { key: 'wide', label: '16:9', ratio: 16 / 9 },
];

// Centre-crop box for a target aspect ratio inside w×h.
function centreCrop(w, h, ratio) {
  const current = w / h;
  if (ratio > current) {
    const height = Math.round(w / ratio);
    return { originX: 0, originY: Math.round((h - height) / 2), width: w, height };
  }
  const width = Math.round(h * ratio);
  return { originX: Math.round((w - width) / 2), originY: 0, width, height: h };
}

export default function MediaPreview({ visible, items, onCancel, onSend, sending }) {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();

  const [list, setList] = useState([]);      // working copies
  const [idx, setIdx] = useState(0);
  const [viewOnce, setViewOnce] = useState(false);
  const [quality, setQuality] = useState('standard');
  const [busy, setBusy] = useState(false);
  const [freeCrop, setFreeCrop] = useState(null);   // { width, height } while editing
  const captionRef = useRef(null);

  // Seed from the picked assets whenever the tray opens.
  useEffect(() => {
    if (!visible) return;
    setList((items || []).map((it) => ({
      ...it,
      originalUri: it.uri,     // the source every transform re-derives from
      uri: it.uri,             // what is displayed and eventually sent
      caption: '',
      crop: 'original',
    })));
    setIdx(0);
    setViewOnce(false);
    setQuality('standard');
  }, [visible, items]);

  const cur = list[idx] || null;

  // Re-derive the current item from its original at the given crop + quality.
  //
  // `cropKey` is either a preset key ('square') or an explicit pixel box from the
  // free-form editor. Both re-derive from originalUri, never from the last
  // render, so cropping twice doesn't crop a crop.
  const applyTransforms = useCallback(async (item, cropKey, qualityKey) => {
    if (item.isVideo) return item.originalUri;   // stills only
    const actions = [];
    if (cropKey && typeof cropKey === 'object') {
      actions.push({ crop: cropKey });            // free-form box, already in px
    } else {
      const preset = CROPS.find((c) => c.key === cropKey);
      if (preset?.ratio) {
        // Dimensions are needed to centre the crop box; the picker supplies them,
        // and a cheap manipulate with no actions reports them when it doesn't.
        let { width, height } = item;
        if (!width || !height) {
          const probe = await ImageManipulator.manipulateAsync(item.originalUri, [], {});
          width = probe.width; height = probe.height;
        }
        actions.push({ crop: centreCrop(width, height, preset.ratio) });
      }
    }
    const q = QUALITY[qualityKey];
    actions.push({ resize: { width: q.maxDim } });
    const out = await ImageManipulator.manipulateAsync(
      item.originalUri, actions,
      { compress: q.compress, format: ImageManipulator.SaveFormat.JPEG },
    );
    return out.uri;
  }, []);

  const setCrop = useCallback(async (cropKey) => {
    if (!cur || cur.isVideo) return;
    setBusy(true);
    try {
      const uri = await applyTransforms(cur, cropKey, quality);
      setList((prev) => prev.map((it, i) => (i === idx ? { ...it, uri, crop: cropKey } : it)));
    } catch (e) {
      log.warn('crop failed', e?.message);
      Alert.alert('Could not crop', e?.message || 'Please try again.');
    } finally { setBusy(false); }
  }, [cur, idx, quality, applyTransforms]);

  // Free-form editor needs the SOURCE dimensions, which the picker doesn't always
  // supply — probe once when opening rather than on every drag.
  const openFreeCrop = useCallback(async () => {
    if (!cur || cur.isVideo) return;
    let { width, height } = cur;
    if (!width || !height) {
      try {
        const probe = await ImageManipulator.manipulateAsync(cur.originalUri, [], {});
        width = probe.width; height = probe.height;
      } catch (e) { log.warn('probe failed', e?.message); }
    }
    setFreeCrop({ width, height });
  }, [cur]);

  // Quality applies to EVERY item, as it does in WhatsApp — it is a send setting,
  // not a per-photo edit.
  const setQualityAll = useCallback(async (next) => {
    setQuality(next);
    setBusy(true);
    try {
      const out = await Promise.all(list.map(async (it) => (
        it.isVideo ? it : { ...it, uri: await applyTransforms(it, it.crop, next) }
      )));
      setList(out);
    } catch (e) {
      log.warn('quality change failed', e?.message);
    } finally { setBusy(false); }
  }, [list, applyTransforms]);

  const removeCurrent = useCallback(() => {
    setList((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (!next.length) { onCancel?.(); return prev; }
      setIdx((i) => Math.max(0, Math.min(i, next.length - 1)));
      return next;
    });
  }, [idx, onCancel]);

  const send = useCallback(async () => {
    if (!list.length) return;
    setBusy(true);
    try {
      const payload = await Promise.all(list.map(async (it) => ({
        fileB64: await FileSystem.readAsStringAsync(it.uri, { encoding: 'base64' }),
        fileName: it.filename || (it.isVideo ? 'video.mp4' : 'photo.jpg'),
        mimetype: it.isVideo ? (it.mimetype || 'video/mp4') : 'image/jpeg',
        kind: it.isVideo ? 'video' : 'image',
        caption: it.caption || '',
        duration: it.duration || 0,
        viewOnce,
      })));
      await onSend?.(payload);
    } catch (e) {
      Alert.alert('Not sent', e?.message || 'Could not prepare the media.');
    } finally { setBusy(false); }
  }, [list, viewOnce, onSend]);

  if (!visible || !cur) return null;

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.head}>
          <TouchableOpacity onPress={onCancel} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={26} color={COLORS.onOverlay} />
          </TouchableOpacity>
          <Text style={s.counter}>{idx + 1} / {list.length}</Text>
          <TouchableOpacity
            style={[s.voBtn, viewOnce && s.voBtnOn]}
            onPress={() => setViewOnce((v) => !v)}
            activeOpacity={0.8}
          >
            <Ionicons name={viewOnce ? 'eye' : 'eye-outline'} size={15} color={viewOnce ? COLORS.onOverlay : 'rgba(255,255,255,0.75)'} />
            <Text style={[s.voTxt, viewOnce && { color: COLORS.onOverlay }]}>View once</Text>
          </TouchableOpacity>
        </View>

        <View style={s.stage}>
          {cur.isVideo ? (
            <View style={s.videoWrap}>
              <Image source={{ uri: cur.uri }} style={s.stageImg} resizeMode="contain" />
              <View style={s.playBadge}><Ionicons name="play" size={26} color={COLORS.onOverlay} /></View>
            </View>
          ) : (
            <Image source={{ uri: cur.uri }} style={s.stageImg} resizeMode="contain" />
          )}
          {busy && (
            <View style={s.busy}><ActivityIndicator color={COLORS.onOverlay} size="large" /></View>
          )}
        </View>

        {/* Edit tools. Hidden for video — neither crop nor re-encode applies. */}
        {!cur.isVideo && (
          <View style={s.tools}>
            {/* Straight into the 4-corner editor — the ratio presets live inside
                it, so the old "tap Crop, then pick a preset" step was a detour
                that hid the free crop behind a second tap. */}
            <TouchableOpacity style={s.tool} onPress={openFreeCrop} disabled={busy}>
              <Ionicons name="crop-outline" size={19} color={COLORS.onOverlay} />
              <Text style={s.toolTxt}>Crop</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.tool, quality === 'hd' && s.toolOn]}
              onPress={() => setQualityAll(quality === 'hd' ? 'standard' : 'hd')}
              disabled={busy}
            >
              <Ionicons name="sparkles-outline" size={18} color={COLORS.onOverlay} />
              <Text style={s.toolTxt}>{QUALITY[quality].label}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.tool} onPress={removeCurrent} disabled={busy}>
              <Ionicons name="trash-outline" size={19} color={COLORS.onOverlay} />
            </TouchableOpacity>
          </View>
        )}

        {/* (The preset chip row moved INTO CropEditor — Free / 1:1 / 4:5 / 16:9
            sit under the live crop box there, where you can see their effect.) */}

        <View style={[s.bottom, { paddingBottom: (kb > 0 ? kb + insets.bottom : insets.bottom) + SPACING.md }]}>
          <View style={s.capRow}>
            <TextInput
              ref={captionRef}
              style={s.caption}
              value={cur.caption}
              onChangeText={(t) => setList((prev) => prev.map((it, i) => (i === idx ? { ...it, caption: t } : it)))}
              placeholder="Add a caption…"
              placeholderTextColor="rgba(255,255,255,0.45)"
              multiline
            />
            <TouchableOpacity style={s.send} onPress={send} disabled={busy || sending} activeOpacity={0.85}>
              {busy || sending
                ? <ActivityIndicator color={COLORS.onOverlay} size="small" />
                : <Ionicons name="send" size={19} color={COLORS.onOverlay} />}
            </TouchableOpacity>
          </View>

          {list.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.strip} contentContainerStyle={{ gap: SPACING.sm }}>
              {list.map((it, i) => (
                <TouchableOpacity
                  key={`${it.originalUri}-${i}`}
                  style={[s.thumb, i === idx && s.thumbOn]}
                  onPress={() => setIdx(i)}
                  activeOpacity={0.8}
                >
                  <Image source={{ uri: it.uri }} style={s.thumbImg} />
                  {it.isVideo && (
                    <View style={s.thumbVid}><Ionicons name="play" size={10} color={COLORS.onOverlay} /></View>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </View>

      {/* Free-form crop, over the tray. Applying re-derives from the original,
          so the user can reopen and re-crop without compounding. */}
      {!!freeCrop && !!cur && (
        <Modal visible transparent={false} animationType="slide" onRequestClose={() => setFreeCrop(null)}>
          <CropEditor
            uri={cur.originalUri}
            width={freeCrop.width}
            height={freeCrop.height}
            busy={busy}
            index={idx}
            count={list.length}
            onPrev={() => setIdx((i) => (i - 1 + list.length) % list.length)}
            onNext={() => setIdx((i) => (i + 1) % list.length)}
            onCancel={() => setFreeCrop(null)}
            onApply={(pxBox) => { setFreeCrop(null); setCrop(pxBox || 'original'); }}
          />
        </Modal>
      )}
    </Modal>
  );
}

const s = themed((C) => ({
  root: { flex: 1, backgroundColor: COLORS.editorBg },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
  },
  counter: { color: COLORS.onOverlay, fontSize: 15, fontWeight: '800' },
  voBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    paddingHorizontal: 10, paddingVertical: 5,
  },
  voBtnOn: { backgroundColor: C.primary, borderColor: C.primary },
  voTxt: { color: 'rgba(255,255,255,0.75)', fontSize: 11.5, fontWeight: '700' },

  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stageImg: { width: SW, height: SH * 0.52 },
  videoWrap: { alignItems: 'center', justifyContent: 'center' },
  playBadge: {
    position: 'absolute', width: 58, height: 58, borderRadius: 29,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  busy: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },

  tools: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.lg, paddingVertical: SPACING.md },
  tool: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: RADIUS.pill,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  toolOn: { backgroundColor: C.primary },
  toolTxt: { color: COLORS.onOverlay, fontSize: 12.5, fontWeight: '700' },

  cropRow: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm, paddingBottom: SPACING.md },
  cropChip: {
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 13, paddingVertical: 6,
  },
  cropChipOn: { backgroundColor: C.primary, borderColor: C.primary },
  cropTxt: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700' },
  cropChipFree: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.onOverlay, borderColor: COLORS.onOverlay,
  },

  bottom: { paddingHorizontal: SPACING.md },
  capRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm },
  caption: {
    flex: 1, minHeight: 46, maxHeight: 110,
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: RADIUS.sheet,
    paddingHorizontal: SPACING.screen, paddingTop: 12, paddingBottom: 12,
    color: COLORS.onOverlay, fontSize: 15,
  },
  send: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },

  strip: { marginTop: SPACING.md, maxHeight: 62 },
  thumb: {
    width: 52, height: 52, borderRadius: RADIUS.sm, overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.1)',
  },
  thumbOn: { borderColor: C.green },
  thumbImg: { width: '100%', height: '100%' },
  thumbVid: {
    position: 'absolute', right: 2, bottom: 2,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, padding: 2,
  },
}));
