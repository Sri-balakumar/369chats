// AudioBubble — inline player for a received voice note: play/pause, a scrubber
// and the running time, the way the web client plays them.
//
// The file is downloaded on FIRST PLAY rather than on render. A thread can hold
// dozens of voice notes; fetching them all as the list scrolls would be a lot of
// traffic for clips nobody plays. It also has to be downloaded rather than
// streamed from the URL, because the media route is cookie-authenticated and the
// player does not carry the session cookie.
import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { COLORS, SPACING } from '../../theme';
import downloadAuthed, { safeName } from '../../utils/downloadAuthed';
import { createLogger } from '../../api/logger';

const log = createLogger('AudioBubble');

function clock(sec) {
  const total = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function AudioBubble({ msg, mine }) {
  const [localUri, setLocalUri] = useState(null);
  const [busy, setBusy] = useState(false);
  const player = useAudioPlayer(localUri ? { uri: localUri } : null);
  const status = useAudioPlayerStatus(player);

  // Rewind once a clip ends so the next tap replays it rather than doing nothing.
  useEffect(() => {
    if (status?.didJustFinish) player.seekTo(0).catch(() => {});
  }, [status?.didJustFinish, player]);

  const toggle = useCallback(async () => {
    if (status?.playing) { player.pause(); return; }
    if (localUri) { player.play(); return; }
    if (!msg.mediaUrl) return;

    setBusy(true);
    try {
      const target = FileSystem.cacheDirectory + safeName(msg.fileName, msg.mimetype || 'audio/m4a', msg.id);
      const uri = await downloadAuthed(msg.mediaUrl, target);
      setLocalUri(uri);
      // The hook swaps source on the next render; play then, not now.
    } catch (e) {
      log.warn('load failed', e?.message);
    } finally {
      setBusy(false);
    }
  }, [status?.playing, localUri, msg, player]);

  // Autoplay the moment the freshly-downloaded file is wired into the player.
  useEffect(() => {
    if (localUri && status?.isLoaded && !status?.playing && (status?.currentTime || 0) === 0) {
      player.play();
    }
    // Only when the source first becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localUri, status?.isLoaded]);

  // Prefer the server's stored duration: it is known before the file is fetched,
  // so the bubble shows a length straight away instead of 0:00.
  const total = status?.duration || msg.duration || 0;
  const at = status?.currentTime || 0;
  const pct = total ? Math.min(100, (at / total) * 100) : 0;
  const tint = mine ? '#0B6B3A' : COLORS.primary;

  return (
    <View style={s.row}>
      <TouchableOpacity onPress={toggle} style={[s.btn, { backgroundColor: tint }]} activeOpacity={0.85}>
        {busy
          ? <ActivityIndicator color="#fff" size="small" />
          : <Ionicons name={status?.playing ? 'pause' : 'play'} size={17} color="#fff" />}
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <View style={s.track}>
          <View style={[s.fill, { width: `${pct}%`, backgroundColor: tint }]} />
        </View>
        <Text style={s.time}>{clock(at > 0 ? at : total)}</Text>
      </View>
      <Ionicons name="mic" size={15} color={mine ? '#5A7A66' : COLORS.slate400} />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, minWidth: 190, paddingVertical: 2 },
  btn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(15,23,42,0.15)', overflow: 'hidden' },
  fill: { height: 3, borderRadius: 2 },
  time: { fontSize: 11, color: COLORS.slate500, marginTop: 4, fontWeight: '600' },
});
