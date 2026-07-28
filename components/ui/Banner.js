// Banner — the inline ok/error strip that sits under a screen header after an
// action succeeds or fails. Renders nothing when there is no message, so callers
// can drop `<Banner banner={banner}/>` in unconditionally.
//
// Shape: { kind: 'ok' | 'err', msg: string }
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../../theme';

export default function Banner({ banner }) {
  if (!banner || !banner.msg) return null;
  const ok = banner.kind === 'ok';
  return (
    <View style={[s.banner, ok ? s.ok : s.err]}>
      <Ionicons
        name={ok ? 'checkmark-circle' : 'alert-circle'} size={15}
        color={ok ? COLORS.green : COLORS.red}
      />
      <Text style={[s.txt, { color: ok ? '#065F46' : COLORS.red }]}>{banner.msg}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    marginHorizontal: SPACING.screen, marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.lg, paddingVertical: 9,
    borderRadius: RADIUS.md, borderWidth: 1,
  },
  ok: { backgroundColor: COLORS.greenBg, borderColor: COLORS.greenLine },
  err: { backgroundColor: COLORS.redBg, borderColor: COLORS.redLine },
  txt: { flex: 1, fontSize: 12.5, fontWeight: '700' },
});
