// CropEditor — free-form crop with four draggable corners, plus optional ratio
// locking and prev/next when there is more than one photo.
//
// Geometry: the crop rectangle is kept in NORMALISED units (0..1 of the image),
// not pixels. The same numbers then work for the on-screen preview at whatever
// size it lays out AND for expo-image-manipulator, which wants source pixels —
// no second coordinate system to keep in sync, and no drift when the image is
// letterboxed inside the stage.
//
// Corners are dragged with PanResponder. Each handle mutates only its own two
// edges, and every edge is clamped so the box can never invert or escape the
// image. With a ratio locked, the dragged corner leads and the opposite corner
// stays pinned.
import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, PanResponder, Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING, themed } from '../../theme';

const { width: SW, height: SH } = Dimensions.get('window');

// Never let the box collapse to nothing — 8% of the shorter side.
const MIN = 0.08;
const HANDLE = 30;

export const RATIOS = [
  { key: 'free', label: 'Free', ratio: null },
  { key: 'square', label: '1:1', ratio: 1 },
  { key: 'portrait', label: '4:5', ratio: 4 / 5 },
  { key: 'wide', label: '16:9', ratio: 16 / 9 },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default function CropEditor({
  uri, width, height, onCancel, onApply, busy,
  index, count, onPrev, onNext,
}) {
  // Normalised crop box.
  const [box, setBox] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [ratioKey, setRatioKey] = useState('free');
  const [stage, setStage] = useState({ w: 0, h: 0 });

  // The image is letterboxed inside the stage, so the DRAWN rect is what the
  // gestures must map onto — not the stage itself.
  const drawn = useMemo(() => {
    if (!stage.w || !stage.h || !width || !height) return { w: stage.w, h: stage.h, left: 0, top: 0 };
    const scale = Math.min(stage.w / width, stage.h / height);
    const w = width * scale;
    const h = height * scale;
    return { w, h, left: (stage.w - w) / 2, top: (stage.h - h) / 2 };
  }, [stage, width, height]);

  // Live values for the pan handlers, which are created once.
  const boxRef = useRef(box);
  boxRef.current = box;
  const drawnRef = useRef(drawn);
  drawnRef.current = drawn;
  const ratioRef = useRef(null);
  ratioRef.current = (RATIOS.find((r) => r.key === ratioKey) || {}).ratio || null;

  // Aspect ratio in NORMALISED space. A 1:1 crop on a 3:2 photo is not w===h in
  // normalised units — it has to be corrected by the image's own aspect.
  const normRatio = useCallback((visualRatio) => {
    if (!visualRatio || !width || !height) return null;
    return visualRatio / (width / height);
  }, [width, height]);

  const makeCorner = (corner) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_e, g) => {
      const d = drawnRef.current;
      if (!d.w || !d.h) return;
      const dx = g.dx / d.w;
      const dy = g.dy / d.h;
      const start = startRef.current;
      if (!start) return;

      let { x, y, w, h } = start;
      const r = normRatio(ratioRef.current);

      // Move the two edges this corner owns; the opposite corner stays put.
      if (corner.includes('l')) { const nx = clamp(start.x + dx, 0, start.x + start.w - MIN); w = start.x + start.w - nx; x = nx; }
      if (corner.includes('r')) { w = clamp(start.w + dx, MIN, 1 - start.x); }
      if (corner.includes('t')) { const ny = clamp(start.y + dy, 0, start.y + start.h - MIN); h = start.y + start.h - ny; y = ny; }
      if (corner.includes('b')) { h = clamp(start.h + dy, MIN, 1 - start.y); }

      if (r) {
        // Width leads, height follows; if that overflows, re-derive from height.
        h = w / r;
        if (y + h > 1) { h = 1 - y; w = h * r; }
        if (corner.includes('t')) y = start.y + start.h - h;
        if (corner.includes('l')) x = start.x + start.w - w;
        if (x < 0) { x = 0; }
        if (y < 0) { y = 0; }
        if (x + w > 1) w = 1 - x;
        if (y + h > 1) h = 1 - y;
      }

      setBox({ x, y, w, h });
    },
    onPanResponderGrant: () => { startRef.current = { ...boxRef.current }; },
  });

  const startRef = useRef(null);

  // Drag the whole box around without resizing it.
  const bodyPan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
    onPanResponderGrant: () => { startRef.current = { ...boxRef.current }; },
    onPanResponderMove: (_e, g) => {
      const d = drawnRef.current;
      const start = startRef.current;
      if (!d.w || !start) return;
      setBox({
        ...start,
        x: clamp(start.x + g.dx / d.w, 0, 1 - start.w),
        y: clamp(start.y + g.dy / d.h, 0, 1 - start.h),
      });
    },
  })).current;

  const corners = useRef({
    tl: makeCorner('tl'), tr: makeCorner('tr'), bl: makeCorner('bl'), br: makeCorner('br'),
  }).current;

  const applyRatio = (key) => {
    setRatioKey(key);
    const visual = (RATIOS.find((r) => r.key === key) || {}).ratio;
    if (!visual) return;                       // Free — leave the box alone
    const r = normRatio(visual);
    // Largest centred box of that ratio.
    let w = 1;
    let h = w / r;
    if (h > 1) { h = 1; w = h * r; }
    setBox({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  };

  const reset = () => { setRatioKey('free'); setBox({ x: 0, y: 0, w: 1, h: 1 }); };

  // Normalised → source pixels, which is what the manipulator wants.
  const apply = () => {
    if (!width || !height) { onApply(null); return; }
    const px = {
      originX: Math.round(box.x * width),
      originY: Math.round(box.y * height),
      width: Math.round(box.w * width),
      height: Math.round(box.h * height),
    };
    // A full-frame box means "no crop" — don't pay for a re-encode.
    const full = px.originX === 0 && px.originY === 0
      && px.width >= width - 1 && px.height >= height - 1;
    onApply(full ? null : px);
  };

  // Crop box in on-screen pixels.
  const r = {
    left: drawn.left + box.x * drawn.w,
    top: drawn.top + box.y * drawn.h,
    width: box.w * drawn.w,
    height: box.h * drawn.h,
  };

  return (
    <View style={s.root}>
      <View style={s.bar}>
        <TouchableOpacity onPress={onCancel} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={25} color={COLORS.onOverlay} />
        </TouchableOpacity>
        <Text style={s.title}>{count > 1 ? `Crop · ${index + 1}/${count}` : 'Crop'}</Text>
        <TouchableOpacity onPress={reset} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.reset}>Reset</Text>
        </TouchableOpacity>
      </View>

      <View style={s.stage} onLayout={(e) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {!!drawn.w && (
          <>
            <Image
              source={{ uri }}
              style={{ position: 'absolute', left: drawn.left, top: drawn.top, width: drawn.w, height: drawn.h }}
              resizeMode="contain"
            />
            {/* Four shades around the box rather than one overlay with a hole —
                React Native has no cut-out, and four views are cheaper than a mask. */}
            <View style={[s.shade, { left: 0, top: 0, right: 0, height: r.top }]} />
            <View style={[s.shade, { left: 0, top: r.top + r.height, right: 0, bottom: 0 }]} />
            <View style={[s.shade, { left: 0, top: r.top, width: r.left, height: r.height }]} />
            <View style={[s.shade, { left: r.left + r.width, top: r.top, right: 0, height: r.height }]} />

            <View {...bodyPan.panHandlers} style={[s.box, r]}>
              {/* Rule-of-thirds guides */}
              <View style={[s.guide, { left: '33.33%', top: 0, bottom: 0, width: 1 }]} />
              <View style={[s.guide, { left: '66.66%', top: 0, bottom: 0, width: 1 }]} />
              <View style={[s.guide, { top: '33.33%', left: 0, right: 0, height: 1 }]} />
              <View style={[s.guide, { top: '66.66%', left: 0, right: 0, height: 1 }]} />
            </View>

            {/* Handles sit OUTSIDE the box view so its pan responder can't eat
                their touches. */}
            <View {...corners.tl.panHandlers} style={[s.handle, { left: r.left - HANDLE / 2, top: r.top - HANDLE / 2 }]}>
              <View style={[s.corner, s.cTL]} />
            </View>
            <View {...corners.tr.panHandlers} style={[s.handle, { left: r.left + r.width - HANDLE / 2, top: r.top - HANDLE / 2 }]}>
              <View style={[s.corner, s.cTR]} />
            </View>
            <View {...corners.bl.panHandlers} style={[s.handle, { left: r.left - HANDLE / 2, top: r.top + r.height - HANDLE / 2 }]}>
              <View style={[s.corner, s.cBL]} />
            </View>
            <View {...corners.br.panHandlers} style={[s.handle, { left: r.left + r.width - HANDLE / 2, top: r.top + r.height - HANDLE / 2 }]}>
              <View style={[s.corner, s.cBR]} />
            </View>
          </>
        )}

        {count > 1 && (
          <>
            <TouchableOpacity style={[s.arrow, { left: 8 }]} onPress={onPrev} activeOpacity={0.8}>
              <Ionicons name="chevron-back" size={24} color={COLORS.onOverlay} />
            </TouchableOpacity>
            <TouchableOpacity style={[s.arrow, { right: 8 }]} onPress={onNext} activeOpacity={0.8}>
              <Ionicons name="chevron-forward" size={24} color={COLORS.onOverlay} />
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={s.ratios}>
        {RATIOS.map((x) => (
          <TouchableOpacity
            key={x.key}
            style={[s.chip, ratioKey === x.key && s.chipOn]}
            onPress={() => applyRatio(x.key)}
            activeOpacity={0.8}
          >
            <Text style={[s.chipTxt, ratioKey === x.key && s.chipTxtOn]}>{x.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={s.apply} onPress={apply} disabled={busy} activeOpacity={0.9}>
        {busy ? <ActivityIndicator color={COLORS.onOverlay} /> : <Text style={s.applyTxt}>Apply crop</Text>}
      </TouchableOpacity>
    </View>
  );
}

const s = themed((C) => ({
  root: { flex: 1, backgroundColor: COLORS.editorBg },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl, paddingTop: 52, paddingBottom: SPACING.md,
  },
  title: { color: COLORS.onOverlay, fontSize: 16, fontWeight: '800' },
  reset: { color: COLORS.onOverlay, fontSize: 14, fontWeight: '700', opacity: 0.85 },

  stage: { flex: 1, margin: SPACING.md, overflow: 'hidden' },
  shade: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  box: { position: 'absolute', borderWidth: 1.5, borderColor: COLORS.onOverlay },
  guide: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.35)' },

  handle: { position: 'absolute', width: HANDLE, height: HANDLE, alignItems: 'center', justifyContent: 'center' },
  corner: { width: 20, height: 20, borderColor: COLORS.onOverlay },
  cTL: { borderLeftWidth: 4, borderTopWidth: 4 },
  cTR: { borderRightWidth: 4, borderTopWidth: 4 },
  cBL: { borderLeftWidth: 4, borderBottomWidth: 4 },
  cBR: { borderRightWidth: 4, borderBottomWidth: 4 },

  arrow: {
    position: 'absolute', top: '48%',
    width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },

  ratios: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm, paddingVertical: SPACING.md },
  chip: {
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.xs,
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  chipOn: { backgroundColor: COLORS.onOverlay, borderColor: COLORS.onOverlay },
  chipTxt: { color: COLORS.onOverlay, fontSize: 13, fontWeight: '700' },
  chipTxtOn: { color: C.navy },

  apply: {
    marginHorizontal: SPACING.xl, marginBottom: 34, height: 50,
    borderRadius: RADIUS.lg, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  applyTxt: { color: COLORS.onOverlay, fontSize: 15.5, fontWeight: '800' },
}));
