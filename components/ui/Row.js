// Row — a label/value line for detail panels. Label left, value right, bolder.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING } from '../../theme';

export default function Row({ label, value, style }) {
  return (
    <View style={[s.row, style]}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs },
  label: { fontSize: 14, color: COLORS.ink, fontWeight: '600' },
  value: { fontSize: 14, color: COLORS.navy, fontWeight: '900' },
});
