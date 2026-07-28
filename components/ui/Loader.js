// Loader — the centred spinner used while a screen's first fetch is in flight.
import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { COLORS } from '../../theme';

export default function Loader({ size = 'large', color = COLORS.primary, style }) {
  return (
    <View style={[s.center, style]}>
      <ActivityIndicator size={size} color={color} />
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
});
