// ChipRow — the horizontal pill filter strip. Each chip is
// { key, label, count? }; the active one fills with the primary colour.
//
// Horizontal FlatList rather than a ScrollView so long filter sets stay virtualised.
//
// The touch handlers below hold off the Chats⇄Calls swipe while a finger is on
// this strip. That swipe runs in the capture phase — the only way to catch a
// gesture starting on a scrollable — which would otherwise outrank this list and
// switch tabs instead of scrolling the chips. See components/chat/SwipeTabs.
import React from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { lockSwipe, unlockSwipe } from '../chat/SwipeTabs';
import { COLORS, RADIUS, SPACING, themed } from '../../theme';

export default function ChipRow({ chips, value, onChange, onLongPress, style }) {
  return (
    <View
      style={[s.row, style]}
      onTouchStart={lockSwipe}
      onTouchEnd={unlockSwipe}
      onTouchCancel={unlockSwipe}
    >
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
              onLongPress={onLongPress ? () => onLongPress(item.key) : undefined}
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

const s = themed((C) => ({
  row: { paddingBottom: SPACING.sm },
  chip: {
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.xs, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: C.line, backgroundColor: COLORS.card,
  },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  txt: { fontSize: 12, fontWeight: '700', color: C.muted },
  txtOn: { color: COLORS.onPrimary },
}));
