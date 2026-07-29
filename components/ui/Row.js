// Row — a label/value line for detail panels. Label left, value right, bolder.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, themed } from '../../theme';

export default function Row({ label, value, style }) {
  return (
    <View style={[s.row, style]}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

const s = themed((C) => ({
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs },
  label: { fontSize: 14, color: C.ink, fontWeight: '600' },
  value: { fontSize: 14, color: C.navy, fontWeight: '900' },
}));
