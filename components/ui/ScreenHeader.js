// ScreenHeader — back chevron, centred title, optional right action.
//
// The app has no navigator headers; every screen draws its own. This is the shape
// they all converged on: a 40x40 white rounded button on the left, a flex-1 centred
// navy title, and either a right action or a 40px spacer so the title stays optically
// centred.
//
// `top` overrides the status-bar inset for screens that sit under a translucent bar.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOW, RADIUS, SPACING, TOP } from '../../theme';

const HIT = { top: 12, bottom: 12, left: 12, right: 12 };

export default function ScreenHeader({ title, onBack, right, top = TOP }) {
  return (
    <View style={[s.header, { paddingTop: top }]}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} hitSlop={HIT} style={s.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={COLORS.navy} />
        </TouchableOpacity>
      ) : <View style={s.spacer} />}
      <Text style={s.title} numberOfLines={1}>{title}</Text>
      {right || <View style={s.spacer} />}
    </View>
  );
}

// Exported so screens can put their own action in the `right` slot and still get
// the same 40x40 white chip.
export function HeaderButton({ icon, onPress, color = COLORS.primary }) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={HIT} style={s.iconBtn}>
      <Ionicons name={icon} size={24} color={color} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: SPACING.lg,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: RADIUS.lg, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },
  spacer: { width: 40 },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', color: COLORS.navy, marginHorizontal: SPACING.sm },
});
