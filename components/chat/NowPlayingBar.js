// NowPlayingBar — the strip the chat list shows while a voice note is still
// playing after you have backed out of the thread, like WhatsApp.
//
// It renders nothing when nothing is playing, so screens can mount it
// unconditionally. Tapping it reopens the chat the clip belongs to; the pause
// button reaches the real player through services/nowPlaying.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING, themed } from '../../theme';
import { subscribeNowPlaying } from '../../services/nowPlaying';

export default function NowPlayingBar({ onOpen }) {
  const [entry, setEntry] = useState(null);
  useEffect(() => subscribeNowPlaying(setEntry), []);
  if (!entry) return null;

  return (
    <TouchableOpacity
      style={s.bar}
      activeOpacity={0.85}
      onPress={() => onOpen?.(entry.conversationId)}
    >
      <View style={s.icon}>
        <Ionicons name="mic" size={15} color={COLORS.onPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.title} numberOfLines={1}>Playing voice message</Text>
        <Text style={s.sub} numberOfLines={1}>{entry.author}</Text>
      </View>
      <TouchableOpacity
        onPress={() => entry.onPause?.()}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={s.pause}
      >
        <Ionicons name="pause" size={18} color={COLORS.primary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const s = themed((C) => ({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    marginHorizontal: SPACING.screen, marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
    backgroundColor: C.tintBg, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: C.line,
  },
  icon: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 13.5, fontWeight: '800', color: C.ink },
  sub: { fontSize: 11.5, color: C.muted, marginTop: 1 },
  pause: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: C.card,
    alignItems: 'center', justifyContent: 'center',
  },
}));
