// Screen — the standard page root: a solid fallback colour with the shared
// gradient painted over it. The solid colour matters: without it a fade-in or an
// over-scroll flashes black behind the SVG gradient.
//
// Every screen used to hand-write `<View style={{flex:1,backgroundColor:COLORS.shell}}>`
// followed by `<GradientBackground/>`; this is that pair, once.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import GradientBackground from '../GradientBackground';
import { COLORS, themed } from '../../theme';

export default function Screen({ children, style, gradient = true }) {
  return (
    <View style={[s.root, style]}>
      {gradient && <GradientBackground />}
      {children}
    </View>
  );
}

const s = themed((C) => ({
  root: { flex: 1, backgroundColor: C.shell },
}));
