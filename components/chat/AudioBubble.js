// AudioBubble — inline player for a received voice note: play/pause, a draggable
// scrubber, a speed control and the running time, the way the web client plays them.
//
// The file is downloaded on FIRST PLAY rather than on render. A thread can hold
// dozens of voice notes; fetching them all as the list scrolls would be a lot of
// traffic for clips nobody plays. It also has to be downloaded rather than
// streamed from the URL, because the media route is cookie-authenticated and the
// player does not carry the session cookie.
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { COLORS, SPACING, themed } from '../../theme';
import downloadAuthed, { safeName } from '../../utils/downloadAuthed';
import { createLogger } from '../../api/logger';
import { setNowPlaying, clearNowPlaying } from '../../services/nowPlaying';

const log = createLogger('AudioBubble');

// Tapping the speed pill walks this cycle, like WhatsApp.
const SPEEDS = [1, 1.5, 2];

function clock(sec) {
  const total = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function AudioBubble({ msg, mine }) {
  const [localUri, setLocalUri] = useState(null);
  const [busy, setBusy] = useState(false);
  const [speed, setSpeed] = useState(1);
  // While dragging, the bar follows the finger rather than the player clock —
  // otherwise the thumb fights the playhead and jitters.
  const [scrubAt, setScrubAt] = useState(null);
  const [barW, setBarW] = useState(0);

  const player = useAudioPlayer(localUri ? { uri: localUri } : null);
  const status = useAudioPlayerStatus(player);

  const total = status?.duration || msg.duration || 0;
  const at = scrubAt != null ? scrubAt : (status?.currentTime || 0);
  const pct = total ? Math.min(100, Math.max(0, (at / total) * 100)) : 0;
  const tint = mine ? COLORS.onBubbleMineTint : COLORS.primary;

  // Refs so the PanResponder (created once) always sees current values.
  const geo = useRef({ w: 0, total: 0 });
  useEffect(() => { geo.current = { w: barW, total }; }, [barW, total]);

  // Stop cleanly at the end: pause, rewind, and drop the now-playing banner.
  // Without the pause the player sat in a "finished but playing" state, so the
  // button still showed a pause icon on a clip that had ended.
  useEffect(() => {
    if (!status?.didJustFinish) return;
    try { player.pause(); } catch (_) {}
    player.seekTo(0).catch(() => {});
    clearNowPlaying(msg.id);
  }, [status?.didJustFinish, player, msg.id]);

  // Publish what is playing so the chat list can show a mini-player.
  useEffect(() => {
    if (status?.playing) {
      setNowPlaying({
        id: msg.id,
        conversationId: msg.conversationId,
        author: msg.authorName || 'Voice message',
        onPause: () => { try { player.pause(); } catch (_) {} },
      });
    } else {
      clearNowPlaying(msg.id);
    }
  }, [status?.playing, msg.id, msg.conversationId, msg.authorName, player]);

  // Leaving the thread must not leave a ghost entry in the mini-player.
  useEffect(() => () => clearNowPlaying(msg.id), [msg.id]);

  const seekToFraction = useCallback((frac) => {
    const { total: dur } = geo.current;
    if (!dur) return;
    player.seekTo(Math.min(dur, Math.max(0, frac * dur))).catch(() => {});
  }, [player]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { w, total: dur } = geo.current;
        if (!w || !dur) return;
        setScrubAt((e.nativeEvent.locationX / w) * dur);
      },
      onPanResponderMove: (e) => {
        const { w, total: dur } = geo.current;
        if (!w || !dur) return;
        const x = Math.min(w, Math.max(0, e.nativeEvent.locationX));
        setScrubAt((x / w) * dur);
      },
      onPanResponderRelease: (e) => {
        const { w, total: dur } = geo.current;
        if (w && dur) {
          const x = Math.min(w, Math.max(0, e.nativeEvent.locationX));
          seekToFraction(x / w);
        }
        setScrubAt(null);
      },
      onPanResponderTerminate: () => setScrubAt(null),
    }),
  ).current;

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

  const cycleSpeed = useCallback(() => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    try { player.setPlaybackRate(next); } catch (_) { /* older expo-audio */ }
  }, [speed, player]);

  // Autoplay the moment the freshly-downloaded file is wired into the player.
  useEffect(() => {
    if (localUri && status?.isLoaded && !status?.playing && (status?.currentTime || 0) === 0) {
      player.play();
    }
    // Only when the source first becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localUri, status?.isLoaded]);

  return (
    <View style={s.row}>
      <TouchableOpacity onPress={toggle} style={[s.btn, { backgroundColor: tint }]} activeOpacity={0.85}>
        {busy
          ? <ActivityIndicator color={COLORS.onPrimary} size="small" />
          : <Ionicons name={status?.playing ? 'pause' : 'play'} size={17} color={COLORS.onPrimary} />}
      </TouchableOpacity>

      <View style={{ flex: 1 }}>
        {/* Generous hit area: a 3pt line is impossible to grab, so the responder
            lives on a padded wrapper and the line is drawn inside it. */}
        <View
          style={s.trackHit}
          onLayout={(e) => setBarW(e.nativeEvent.layout.width)}
          {...pan.panHandlers}
        >
          <View style={s.track}>
            <View style={[s.fill, { width: `${pct}%`, backgroundColor: tint }]} />
          </View>
          <View style={[s.thumb, { left: `${pct}%`, backgroundColor: tint }]} />
        </View>
        <Text style={s.time}>
          {clock(at > 0 || status?.playing ? at : total)}
          {total ? ` / ${clock(total)}` : ''}
        </Text>
      </View>

      <TouchableOpacity onPress={cycleSpeed} style={s.speed} activeOpacity={0.7}>
        <Text style={[s.speedTxt, { color: tint }]}>{speed}×</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = themed((C) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, minWidth: 210, paddingVertical: 2 },
  btn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  trackHit: { paddingVertical: 9, justifyContent: 'center' },
  track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(15,23,42,0.15)', overflow: 'hidden' },
  fill: { height: 3, borderRadius: 2 },
  thumb: {
    position: 'absolute', width: 11, height: 11, borderRadius: 6, marginLeft: -5.5,
    top: '50%', marginTop: -5.5,
  },
  time: { fontSize: 11, color: C.slate500, marginTop: 2, fontWeight: '600' },
  speed: { paddingHorizontal: 4, paddingVertical: 2 },
  speedTxt: { fontSize: 11.5, fontWeight: '900' },
}));
