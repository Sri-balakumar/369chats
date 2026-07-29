// SectionCard — the settings-style panel: a coloured left edge, an icon + title
// head bar, and a padded body. `color` tints both the left border and the icon.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from './Icon';
import { COLORS, SHADOW, RADIUS, SPACING, themed } from '../../theme';

export default function SectionCard({ color = COLORS.primary, icon, iconLib, title, children, style }) {
  return (
    <View style={[s.card, { borderLeftColor: color }, style]}>
      <View style={s.head}>
        {!!icon && <Icon lib={iconLib} name={icon} size={18} color={color} />}
        <Text style={s.title}>{title}</Text>
      </View>
      <View style={s.body}>{children}</View>
    </View>
  );
}

const s = themed((C) => ({
  card: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.xl, marginBottom: 16,
    borderLeftWidth: 4, overflow: 'hidden', ...SHADOW,
  },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.lg,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  title: { fontSize: 14.5, fontWeight: '800', color: C.navy },
  body: { padding: SPACING.screen },
}));
