// SPLASH / INTRO — plays the branded animation, then hands off to the app.
//
// This replaced a hand-built animated intro (floating cards, a spinning six-segment
// wheel, waves). The video is the brand asset now, so the drawing code is gone
// rather than left dormant.
//
// Two things worth knowing:
//
//   • There are TWO splashes. The NATIVE one (expo-splash-screen, configured in
//     app.json) covers the time before JS is running and can only ever be a static
//     image — no video, on either platform. This screen is the JS one, which takes
//     over once React mounts. They are set to the same white background so the
//     handoff is invisible; changing one without the other brings back a colour
//     flash on launch.
//
//   • onDone must fire exactly once and must not depend on the video. A splash
//     that can hang is a splash that can brick the app, so a failed load, a
//     missing codec or a stalled decode all still fall through the timeout below.
import React, { useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';

const { width: SW, height: SH } = Dimensions.get('window');

// The animation sits centred at a comfortable size rather than filling the
// screen — full-bleed made the mark enormous on a tablet. Capped against height
// too so a short landscape window cannot crop it.
const VIDEO = Math.min(SW * 0.62, SH * 0.4);

// Hard ceiling. The animation is ~4s; this only exists so a video that never
// reports completion cannot strand the user on a blank screen.
const MAX_MS = 6000;

// Held after the video ends so the last frame is not snatched away mid-beat.
const SETTLE_MS = 150;

export default function SplashScreen({ onDone }) {
  const doneRef = useRef(false);

  // Guarded so playToEnd, an error and the timeout can all race harmlessly.
  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone?.();
  }, [onDone]);

  const player = useVideoPlayer(require('../assets/splash369.mp4'), (p) => {
    p.loop = false;
    p.muted = true;      // a launch animation that makes noise is a bug report
    p.play();
  });

  useEffect(() => {
    // expo-video's SharedObject listeners; `playToEnd` is the completion signal.
    const end = player.addListener('playToEnd', () => setTimeout(finish, SETTLE_MS));
    // A source that fails to load reports through statusChange, not playToEnd.
    const status = player.addListener('statusChange', ({ status: st, error }) => {
      if (st === 'error' || error) finish();
    });
    const t = setTimeout(finish, MAX_MS);
    return () => {
      clearTimeout(t);
      end?.remove?.();
      status?.remove?.();
    };
  }, [player, finish]);

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <VideoView
        style={s.video}
        player={player}
        contentFit="contain"
        nativeControls={false}
        allowsFullscreen={false}
        allowsPictureInPicture={false}
      />
    </View>
  );
}

// Not `themed()` — the video has a baked-in white background, so this screen is
// deliberately the one place that does not follow the app theme.
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  video: { width: VIDEO, height: VIDEO },
});
