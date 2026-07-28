// StatCard — a stats-strip card: pastel background, white icon chip, a big count,
// and a label. Shares AnimatedTile's entrance and press-spring.
//
// count === null means the number is still loading, so a spinner stands in for it
// rather than a flash of 0 — the count is the whole point of the card.
import React from 'react';
import {
  View, Text, TouchableOpacity, Animated, ActivityIndicator, Dimensions, StyleSheet,
} from 'react-native';
import Icon from './Icon';
import { useTileAnimation } from './AnimatedTile';
import { COLORS } from '../../theme';

const SW = Dimensions.get('window').width;
export const STAT_W = (SW - 20 * 2 - 12) / 2;

export default function StatCard({ stat, count, index = 0, onPress, width = STAT_W }) {
  const { style, pressIn, pressOut } = useTileAnimation(index);
  return (
    <Animated.View style={style}>
      <TouchableOpacity
        style={[s.card, { backgroundColor: stat.bg, width }]} activeOpacity={0.9}
        onPress={onPress} onPressIn={pressIn} onPressOut={pressOut}
      >
        <View style={s.chip}>
          <Icon lib={stat.lib} name={stat.name} size={22} color={stat.fg} />
        </View>
        {count === null
          ? <ActivityIndicator color={stat.fg} style={{ marginTop: 8, alignSelf: 'flex-start' }} />
          : <Text style={[s.count, { color: stat.fg }]}>{count}</Text>}
        <Text style={s.label}>{stat.label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: {
    minHeight: 108, borderRadius: 18, padding: 16,
    shadowColor: '#334155', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  chip: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  count: { fontSize: 30, fontWeight: '900', marginTop: 8 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.ink, marginTop: 2 },
});
