// ChipRow — the horizontal pill filter strip. Each chip is
// { key, label, count? }; the active one fills with the primary colour.
//
// Horizontal FlatList rather than a ScrollView so long filter sets stay virtualised.
import React from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../../theme';

export default function ChipRow({ chips, value, onChange, style }) {
  return (
    <View style={[s.row, style]}>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={chips}
        keyExtractor={(c) => String(c.key)}
        contentContainerStyle={{ paddingHorizontal: SPACING.screen, gap: SPACING.sm }}
        renderItem={({ item }) => {
          const on = value === item.key;
          return (
            <TouchableOpacity
              style={[s.chip, on && s.chipOn]}
              onPress={() => onChange(item.key)}
              activeOpacity={0.85}
            >
              <Text style={[s.txt, on && s.txtOn]}>
                {item.label}{item.count != null ? ` ${item.count}` : ''}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  row: { paddingBottom: SPACING.sm },
  chip: {
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.xs, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.line, backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  txt: { fontSize: 12, fontWeight: '700', color: COLORS.muted },
  txtOn: { color: '#fff' },
});
