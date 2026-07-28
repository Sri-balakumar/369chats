// Accordion — a Card whose header toggles a body open/closed, with the smooth
// height transition the app used for every drill-down list.
//
// LayoutAnimation needs the experimental flag on Android or the expand snaps; the
// flag is set once at module load. animateNext() is exported because a few callers
// drive their own expand state and just want the same easing.
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  LayoutAnimation, Platform, UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from './Card';
import { COLORS, SPACING } from '../../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export const animateNext = () => LayoutAnimation.configureNext(
  LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
);

export default function Accordion({ title, sub, right, children, defaultOpen = false, style }) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => { animateNext(); setOpen((o) => !o); };

  return (
    <Card style={[s.card, style]}>
      <TouchableOpacity style={s.head} onPress={toggle} activeOpacity={0.7}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{title}</Text>
          {!!sub && <Text style={s.sub}>{sub}</Text>}
        </View>
        {right}
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'} size={18}
          color={COLORS.slate400} style={{ marginLeft: SPACING.xs }}
        />
      </TouchableOpacity>
      {open && <View style={s.body}>{children}</View>}
    </Card>
  );
}

const s = StyleSheet.create({
  // Padding moves to the head/body so the divider can span the full card width.
  card: { padding: 0, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', padding: SPACING.screen },
  title: { fontSize: 15, fontWeight: '800', color: COLORS.slate900 },
  sub: { fontSize: 12, color: COLORS.slate500, marginTop: 2 },
  body: {
    borderTopWidth: 1, borderTopColor: COLORS.slate100,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.sm,
  },
});
