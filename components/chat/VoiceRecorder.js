// VoiceRecorder — record a voice note, with pause/resume, playback preview,
// delete and send, mirroring what the module's web client offers.
//
// Two states, and the UI is deliberately different in each:
//   RECORDING — red dot, live timer, a live level meter, pause/resume, bin, stop
//   PREVIEW   — play/pause the take, scrub position, bin, send
//
// Built on expo-audio (SDK 54's recorder; expo-av is deprecated). It IS a native
// module, so this only runs in a development build — not in Expo Go.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder, useAudioRecorderState, useAudioPlayer, useAudioPlayerStatus,
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { COLORS, RADIUS, SPACING } from '../../theme';
import { createLogger } from '../../api/logger';

const log = createLogger('Voice');

// mm:ss from milliseconds.
function clock(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// A cheap level meter: 26 bars whose heights come from the metering value, with
// the newest on the right. Metering is dBFS (roughly -160..0), so it is mapped
// onto 0..1 before use.
function Meter({ level, active }) {
  const bars = useRef(Array.from({ length: 26 }, () => 0.12)).current;
  const [, force] = useState(0);

  useEffect(() => {
    if (!active) return;
    const norm = Math.max(0.08, Math.min(1, (level + 60) / 60 || 0.08));
    bars.shift();
    bars.push(norm);
    force((n) => n + 1);
  }, [level, active, bars]);

  return (
    <View style={s.meter}>
      {bars.map((h, i) => (
        <View
          key={i}
          style={[s.bar, { height: 4 + h * 22, opacity: active ? 0.5 + h * 0.5 : 0.3 }]}
        />
      ))}
    </View>
  );
}

export default function VoiceRecorder({ onCancel, onSend, sending }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // 100ms polling gives a timer that ticks smoothly and a usable level meter.
  const state = useAudioRecorderState(recorder, 100);

  const [takeUri, setTakeUri] = useState(null);   // set once stopped → preview
  const [takeMs, setTakeMs] = useState(0);
  const [starting, setStarting] = useState(true);

  const player = useAudioPlayer(takeUri ? { uri: takeUri } : null);
  const playback = useAudioPlayerStatus(player);

  // ── start on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Microphone needed', 'Allow microphone access to record a voice message.');
          onCancel?.();
          return;
        }
        // allowsRecording must be on to capture; playsInSilentMode so the preview
        // is audible on a phone with the ringer switched off.
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        if (!alive) return;
        recorder.record();
        setStarting(false);
      } catch (e) {
        log.warn('start failed', e?.message);
        Alert.alert('Could not record', e?.message || 'The microphone is unavailable.');
        onCancel?.();
      }
    })();
    return () => { alive = false; };
    // Mount-only: re-running this would start a second recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving recording mode must always release the mic, however we got here.
  useEffect(() => () => {
    (async () => {
      try { if (recorder.isRecording) await recorder.stop(); } catch (_) {}
      try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch (_) {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pause = useCallback(() => {
    try { recorder.pause(); } catch (e) { log.warn('pause failed', e?.message); }
  }, [recorder]);

  // record() after pause() resumes the same file rather than starting a new one.
  const resume = useCallback(() => {
    try { recorder.record(); } catch (e) { log.warn('resume failed', e?.message); }
  }, [recorder]);

  const stop = useCallback(async () => {
    try {
      const ms = state.durationMillis || 0;
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) { Alert.alert('Nothing recorded', 'Try holding the mic a little longer.'); onCancel?.(); return; }
      setTakeMs(ms);
      setTakeUri(uri);
      // Turn recording mode back off so playback routes to the loudspeaker
      // instead of the earpiece.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch (e) {
      log.warn('stop failed', e?.message);
      Alert.alert('Could not stop', e?.message || 'Please try again.');
    }
  }, [recorder, state.durationMillis, onCancel]);

  const discard = useCallback(async () => {
    try { if (recorder.isRecording) await recorder.stop(); } catch (_) {}
    try { if (takeUri) await FileSystem.deleteAsync(takeUri, { idempotent: true }); } catch (_) {}
    onCancel?.();
  }, [recorder, takeUri, onCancel]);

  const send = useCallback(async () => {
    if (!takeUri) return;
    try {
      const b64 = await FileSystem.readAsStringAsync(takeUri, { encoding: 'base64' });
      // The extension the recorder produces differs per platform (.m4a / .3gp);
      // mimetype is taken on trust by the server, so send something honest.
      const ext = (takeUri.split('.').pop() || 'm4a').toLowerCase();
      await onSend({
        fileB64: b64,
        fileName: `voice-${Date.now()}.${ext}`,
        mimetype: ext === 'm4a' ? 'audio/m4a' : `audio/${ext}`,
        duration: Math.round(takeMs / 1000),
      });
    } catch (e) {
      Alert.alert('Not sent', e?.message || 'Could not read the recording.');
    }
  }, [takeUri, takeMs, onSend]);

  const previewing = !!takeUri;
  const elapsed = previewing
    ? (playback?.currentTime || 0) * 1000
    : (state.durationMillis || 0);
  const total = previewing ? takeMs : null;

  return (
    <View style={s.wrap}>
      <TouchableOpacity onPress={discard} style={s.iconBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="trash-outline" size={22} color={COLORS.red} />
      </TouchableOpacity>

      <View style={s.middle}>
        {!previewing && <View style={[s.dot, { opacity: state.isRecording ? 1 : 0.3 }]} />}
        <Text style={s.time}>
          {clock(elapsed)}{total ? ` / ${clock(total)}` : ''}
        </Text>
        <Meter level={state.metering ?? -60} active={state.isRecording} />
      </View>

      {previewing ? (
        <TouchableOpacity
          onPress={() => (playback?.playing ? player.pause() : player.play())}
          style={s.iconBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name={playback?.playing ? 'pause' : 'play'} size={24} color={COLORS.primary} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={state.isRecording ? pause : resume}
          disabled={starting}
          style={s.iconBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name={state.isRecording ? 'pause' : 'play'} size={24} color={COLORS.primary} />
        </TouchableOpacity>
      )}

      <TouchableOpacity
        onPress={previewing ? send : stop}
        disabled={sending || starting}
        style={[s.round, (sending || starting) && { backgroundColor: COLORS.slate400 }]}
        activeOpacity={0.85}
      >
        <Ionicons name={previewing ? 'send' : 'stop'} size={previewing ? 19 : 20} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.sm,
  },
  iconBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#1e293b', shadowOpacity: 0.06, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  middle: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: '#fff', borderRadius: RADIUS.sheet, height: 48,
    paddingHorizontal: SPACING.lg,
    shadowColor: '#1e293b', shadowOpacity: 0.06, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: COLORS.red },
  time: { fontSize: 13.5, fontWeight: '800', color: COLORS.ink, minWidth: 42 },
  meter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 28, overflow: 'hidden' },
  bar: { flex: 1, borderRadius: 1.5, backgroundColor: COLORS.primary },
  round: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
});
