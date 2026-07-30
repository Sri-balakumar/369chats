// VideoStage — in-app video playback, the surface MediaViewer shows for a video.
//
// The file is DOWNLOADED first and the player is pointed at the local copy.
// That is not laziness: /chats_369/media/<id> is auth='user' and the credential
// is the Odoo session COOKIE held in the platform jar, so expo-video's
// VideoSource.headers cannot carry it — there is no header to send. A local file
// needs no auth at all. components/chat/AudioBubble.js resolves voice notes the
// same way, and downloadAuthed is the same helper the thread's tap-to-open uses,
// so a video already opened once plays straight from cache.
//
// Rendered ONLY for kind === 'video', which is why useVideoPlayer can live here
// unconditionally: the hook mounts and unmounts with the video branch.
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEventListener } from 'expo';
import downloadAuthed, { safeName } from '../../utils/downloadAuthed';
import { COLORS, RADIUS, SPACING, themed } from '../../theme';
import { createLogger } from '../../api/logger';

const log = createLogger('VideoStage');

export default function VideoStage({ message, style, onOpenExternally }) {
  const [localUri, setLocalUri] = useState(null);
  const [error, setError] = useState(null);

  const { mediaUrl, id, fileName, mimetype } = message || {};

  useEffect(() => {
    let alive = true;
    setLocalUri(null);
    setError(null);
    if (!mediaUrl) return undefined;
    (async () => {
      try {
        const target = FileSystem.cacheDirectory + safeName(fileName, mimetype, id);
        const uri = await downloadAuthed(mediaUrl, target);
        if (alive) setLocalUri(uri);
      } catch (e) {
        log.warn('download failed', e?.message);
        if (alive) setError(e?.message || 'This video could not be loaded.');
      }
    })();
    return () => { alive = false; };
  }, [mediaUrl, id, fileName, mimetype]);

  // null is a valid VideoSource. useVideoPlayer keys its player on the source, so
  // the null → local-file switch builds a fresh player and re-runs this setup —
  // which is what makes it start playing the moment the download lands.
  const player = useVideoPlayer(localUri ? { uri: localUri } : null, (p) => {
    p.loop = false;
    p.play();
  });

  // Playback can fail on a file that downloaded fine (a codec the device has no
  // decoder for), so this is a separate failure from the fetch above.
  useEventListener(player, 'statusChange', ({ status, error: err }) => {
    if (status === 'error') {
      log.warn('playback failed', err?.message);
      setError('This video cannot be played on this device.');
    }
  });

  if (error) {
    return (
      <View style={[s.fallback, style]}>
        <Ionicons name="alert-circle-outline" size={56} color={COLORS.onOverlay} />
        <Text style={s.msg}>{error}</Text>
        {!!onOpenExternally && (
          <TouchableOpacity style={s.btn} onPress={onOpenExternally} activeOpacity={0.9}>
            <Ionicons name="open-outline" size={18} color={COLORS.onOverlay} />
            <Text style={s.btnTxt}>Open in another app</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (!localUri) {
    return (
      <View style={[s.fallback, style]}>
        <ActivityIndicator size="large" color={COLORS.onOverlay} />
        <Text style={s.msg}>Loading video…</Text>
      </View>
    );
  }

  return (
    <VideoView
      style={style}
      player={player}
      contentFit="contain"
      nativeControls
      fullscreenOptions={{ enable: true }}
      allowsPictureInPicture={false}
    />
  );
}

const s = themed((C) => ({
  fallback: { alignItems: 'center', justifyContent: 'center', gap: SPACING.lg, paddingHorizontal: 30 },
  msg: { color: COLORS.onOverlay, fontSize: 14.5, fontWeight: '700', textAlign: 'center' },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    minWidth: 190, height: 46, borderRadius: RADIUS.lg, backgroundColor: C.primary,
  },
  btnTxt: { color: COLORS.onOverlay, fontSize: 15, fontWeight: '800' },
}));
