// Card — the white rounded panel that every list row and detail block is built on.
// `onPress` makes it tappable with the standard 0.85 activeOpacity; without it the
// card is a plain View (no touch handler, so it stays accessible as static content).
import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SHADOW, RADIUS, SPACING } from '../../theme';

export default function Card({ children, style, onPress }) {
  if (onPress) {
    return (
      <TouchableOpacity style={[s.card, style]} onPress={onPress} activeOpacity={0.85}>
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={[s.card, style]}>{children}</View>;
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: RADIUS.xl, padding: SPACING.screen,
    marginBottom: SPACING.lg, borderWidth: 1, borderColor: COLORS.line, ...SHADOW,
  },
});
