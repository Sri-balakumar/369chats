// VIDEO TILE — what a video looks like before you open it.
//
// Videos used to be rendered with AuthImage, the same component photos use. That
// was quietly awful: AuthImage downloads the bytes and hands them to RN's
// <Image>, which cannot decode an mp4, so every video in the app downloaded in
// FULL and then rendered the grey broken-image placeholder. The user paid for the
// whole file and got nothing to look at.
//
// This renders a real video tile instead and downloads nothing.
//
// It is deliberately NOT a poster frame yet. expo-video can generate one
// (player.generateThumbnailsAsync), but the VideoThumbnail it returns is a
// SharedRef that only renders through expo-image, which this project does not
// depend on. Adding a native dependency needs a build to verify, so that is a
// separate change — see HANDOFF. Until then this is honest and cheap, rather
// than expensive and broken.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, themed } from '../../theme';

export default function VideoThumb({ style, iconSize = 22 }) {
  return (
    <View style={[style, s.tile]}>
      <View style={s.badge}>
        <Ionicons name="play" size={iconSize} color={COLORS.onOverlay} />
      </View>
    </View>
  );
}

const s = themed((C) => StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.slate700 },
  badge: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
}));
