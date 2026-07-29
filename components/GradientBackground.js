// Shared app background — the brand gradient behind every screen. Drop
// <GradientBackground/> as the FIRST child of a screen's root View (which should
// be transparent), so every page shares one consistent backdrop.
//
// The stops come from the live palette rather than constants, so this is what
// actually repaints the app when the theme flips.
import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { COLORS } from '../theme';

export default function GradientBackground() {
  // Read inside render: COLORS is a proxy onto the active palette.
  const top = COLORS.bgTop;
  const bottom = COLORS.bgBottom;
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        {/* The gradient id must change with the stops — iOS caches the Defs by id
            and would keep painting the old ramp after a theme flip otherwise. */}
        <LinearGradient id={`appBg-${top}-${bottom}`} x1="0" y1="0" x2="0.6" y2="1">
          <Stop offset="0" stopColor={top} />
          <Stop offset="1" stopColor={bottom} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#appBg-${top}-${bottom})`} />
    </Svg>
  );
}
