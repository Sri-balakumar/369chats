// AnimatedTile — the Home quick-action tile: cascades in (fade + slide-up,
// staggered by index) and scales down while pressed, springing back on release.
//
// `tile` is { label, lib, name, bg, fg }. Width defaults to two per row at the
// Home screen's 20pt page padding and 12pt gutter.
import React, { useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Animated, Easing, Dimensions, StyleSheet,
} from 'react-native';
import Icon from './Icon';
import { COLORS, themed } from '../../theme';

const SW = Dimensions.get('window').width;
export const TILE_W = (SW - 20 * 2 - 12) / 2;

// The entrance both tiles share: 380ms ease-out, 55ms of stagger per position.
export function useTileAnimation(index) {
  const anim = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1, duration: 380, delay: index * 55,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, [anim, index]);

  const pressIn = () => Animated.spring(press, { toValue: 0.96, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const pressOut = () => Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }).start();

  const style = {
    opacity: anim,
    transform: [
      { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
      { scale: press },
    ],
  };
  return { style, pressIn, pressOut };
}

export default function AnimatedTile({ tile, index = 0, onPress, width = TILE_W }) {
  const { style, pressIn, pressOut } = useTileAnimation(index);
  return (
    <Animated.View style={style}>
      <TouchableOpacity
        style={[s.card, { backgroundColor: tile.bg, width }]} activeOpacity={0.9}
        onPress={onPress} onPressIn={pressIn} onPressOut={pressOut}
      >
        <View style={s.chip}>
          <Icon lib={tile.lib} name={tile.name} size={22} color={tile.fg} />
        </View>
        <Text style={s.label} numberOfLines={2}>{tile.label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const s = themed((C) => ({
  card: {
    minHeight: 68, borderRadius: 16,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    shadowColor: COLORS.slate700, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  chip: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  label: { flex: 1, fontSize: 12.5, fontWeight: '800', color: C.ink },
}));
