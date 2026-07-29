// BottomTabs — a floating gradient pill, matching the Advertisement_app design:
// a content-width bar that wraps tightly around its items, centred and lifted off
// the bottom, sitting inside a 2px gradient border.
//
// The gradient is drawn with react-native-svg rather than expo-linear-gradient
// because svg is already a dependency — pulling in expo-linear-gradient would be
// another native module and another dev build. Same for expo-haptics, so the
// press feedback here is visual (opacity) rather than a tap.
//
// It floats ABOVE the content, so every screen that shows it must reserve
// TABBAR_SPACE at the bottom of its scroll content or the last row hides behind it.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, themed } from '../../theme';

const TABS = [
  { key: 'chats', label: 'Chats', on: 'chatbubbles', off: 'chatbubbles-outline' },
  { key: 'calls', label: 'Calls', on: 'call', off: 'call-outline' },
];

// What a screen should leave clear at the bottom for the floating bar.
export const TABBAR_SPACE = 92;

// Outer height of the pill: 2px gradient border + 8px bar padding + a 22 icon,
// a 3 gap and an ~13 label, plus the item's own 2. Exported so a screen can put
// something ELSE on the same line (the chat list's + button) and stay aligned
// instead of hardcoding a guess that drifts when the pill changes.
export const TABBAR_HEIGHT = 62;

// The pill's distance from the bottom edge. Gesture-nav phones report a real
// inset; button-nav phones report 0, so it falls back to a visible margin.
export const tabbarBottom = (insetBottom) => (insetBottom > 0 ? insetBottom : 10);

export default function BottomTabs({ active, onChange, counts = {} }) {
  const insets = useSafeAreaInsets();
  const bottom = tabbarBottom(insets.bottom);

  // The gradient rect needs REAL pixel dimensions. Percentage width/height on an
  // <Svg> with no viewBox resolves inconsistently on Android — it renders a
  // partial fill that reads as a diagonal wedge from one corner. Measuring the
  // container and passing numbers removes the ambiguity entirely.
  const [size, setSize] = React.useState({ w: 0, h: 0 });

  return (
    <View style={[s.wrap, { bottom }]} pointerEvents="box-none">
      <View
        style={s.grad}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          // Guard against re-render loops from sub-pixel layout jitter.
          if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) {
            setSize({ w: width, h: height });
          }
        }}
      >
        {/* The gradient is the 2px border: a fill behind a slightly smaller
            opaque bar, which is cheaper than masking. */}
        {size.w > 0 && (
          <Svg style={StyleSheet.absoluteFill} width={size.w} height={size.h}>
            <Defs>
              <LinearGradient id="tabgrad" x1="0" y1="0" x2={size.w} y2={size.h} gradientUnits="userSpaceOnUse">
                {/* brand → accent, the web module's own pairing. */}
                <Stop offset="0" stopColor={COLORS.primary} />
                <Stop offset="1" stopColor={COLORS.accent} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width={size.w} height={size.h} rx="30" ry="30" fill="url(#tabgrad)" />
          </Svg>
        )}

        <View style={s.bar}>
          {TABS.map((t) => {
            const on = active === t.key;
            const n = counts[t.key] || 0;
            const color = on ? COLORS.primary : COLORS.slate500;
            return (
              <Pressable
                key={t.key}
                onPress={() => onChange(t.key)}
                style={({ pressed }) => [s.item, pressed && { opacity: 0.6 }]}
                hitSlop={6}
              >
                <View>
                  <Ionicons name={on ? t.on : t.off} size={22} color={color} />
                  {n > 0 && (
                    <View style={s.badge}>
                      <Text style={s.badgeTxt}>{n > 99 ? '99+' : n}</Text>
                    </View>
                  )}
                </View>
                <Text style={[s.label, { color }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const s = themed((C) => ({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  grad: {
    borderRadius: 30,
    padding: 2,
    shadowColor: COLORS.link,
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 28,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  item: { alignItems: 'center', gap: 3, paddingHorizontal: 22, paddingVertical: 2 },
  label: { fontSize: 11, fontWeight: '700' },
  badge: {
    position: 'absolute', top: -5, right: -10,
    minWidth: 17, height: 17, borderRadius: 9, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
    borderWidth: 1.5, borderColor: COLORS.card,
  },
  badgeTxt: { color: COLORS.onPrimary, fontSize: 9.5, fontWeight: '900' },
}));
