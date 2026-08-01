// The in-call / incoming-call surface, styled after WhatsApp.
//
// Deliberately NOT a routed screen and NOT a <Modal>. It is an absolutely
// positioned layer mounted once at the top of App, for two reasons:
//
//  * A call has to interrupt whatever is on screen — the chat list, a thread, the
//    settings sheet — and routing to it would lose the user's place and fight the
//    back handler.
//  * Two RN <Modal>s cannot stack on Android; opening one from inside another's
//    onPress silently shows nothing. components/ui/ConfirmDialog.js is an in-tree
//    layer for exactly this reason, and this follows that precedent.
//
// It owns NO call state. callEngine is the single source of truth and pushes
// snapshots; this renders them and forwards button presses. Keeping that boundary
// is what makes it safe to restyle freely — nothing here can break signalling.
import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Vibration, StyleSheet, Platform, Animated, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { RTCView } from 'react-native-webrtc';
import { Avatar } from '../components/ui';
import callEngine from '../services/callEngine';
import { RADIUS, SPACING, themed } from '../theme';

// Ring pattern: buzz, pause, repeat. The second arg to Vibration.vibrate makes it
// loop, and it MUST be cancelled explicitly or it keeps going after the call ends.
const RING_PATTERN = [0, 700, 1200];

// How long the video controls stay up after a tap before fading away again.
const CONTROLS_HIDE_MS = 4000;

function timeLabel(secs) {
  const s = Number(secs) || 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Mirrors callStatusLabel() in the web client so both ends read the same.
function statusLabel(call) {
  if (!call) return '';
  if (call.status === 'connected') return timeLabel(call.secs);
  if (call.status === 'outgoing') return 'Ringing…';
  if (call.status === 'connecting') return 'Connecting…';
  return call.video ? 'Incoming video call' : 'Incoming voice call';
}

export default function CallScreen() {
  const [call, setCall] = useState(() => callEngine.getState());
  const insets = useSafeAreaInsets();
  const ringing = useRef(false);

  // Video controls fade out so they don't sit over the remote picture. Voice
  // calls keep theirs up permanently — there is nothing to obscure.
  const [controlsUp, setControlsUp] = useState(true);
  const fade = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef(null);

  useEffect(() => callEngine.subscribe(setCall), []);

  // Vibrate only while genuinely ringing in. Tied to the rendered state rather
  // than to an engine event so it can never outlive the UI that started it.
  const isIncoming = !!call && call.status === 'incoming';
  useEffect(() => {
    if (isIncoming && !ringing.current) {
      ringing.current = true;
      Vibration.vibrate(RING_PATTERN, true);
    } else if (!isIncoming && ringing.current) {
      ringing.current = false;
      Vibration.cancel();
    }
  }, [isIncoming]);

  // A crash or unmount mid-ring would otherwise leave the phone buzzing.
  useEffect(() => () => { Vibration.cancel(); }, []);

  const showControls = useCallback((autoHide) => {
    clearTimeout(hideTimer.current);
    setControlsUp(true);
    Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    if (!autoHide) return;
    hideTimer.current = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 350, useNativeDriver: true })
        .start(() => setControlsUp(false));
    }, CONTROLS_HIDE_MS);
  }, [fade]);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const video = !!call?.video;
  const status = call?.status;
  const connected = status === 'connected';
  const remoteStream = call?.remoteStream;
  const localStream = call?.localStream;
  const showRemoteVideo = video && connected && !!remoteStream;

  // Start the auto-hide only once the remote picture is actually up; before that
  // there is nothing to hide and vanishing controls just look broken.
  useEffect(() => {
    if (showRemoteVideo) showControls(true);
    else showControls(false);
  }, [showRemoteVideo, showControls]);

  if (!call) return null;

  const { muted, camOff } = call;
  const showLocalVideo = video && !camOff && !!localStream;
  const incoming = status === 'incoming';

  return (
    <Pressable
      style={s.root}
      onPress={() => showRemoteVideo && showControls(true)}
      // A voice call has nothing to reveal, so swallowing taps there would just
      // feel unresponsive.
      disabled={!showRemoteVideo}
    >
      {/* Remote video, full bleed, sits under everything else. */}
      {showRemoteVideo && (
        <RTCView
          streamURL={remoteStream.toURL()}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          zOrder={0}
        />
      )}

      {/* Backdrop for voice calls / pre-connect: the contact's own avatar blown
          up and blurred behind a dark scrim. This is what gives the WhatsApp
          look without shipping any artwork. expo-blur is already a dependency
          (see screens/ConnectScreen.js). */}
      {!showRemoteVideo && (
        <View style={StyleSheet.absoluteFill}>
          <View style={s.blurHost}>
            <Avatar name={call.name} uri={call.avatar} size={520} />
          </View>
          <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={s.scrim} />
        </View>
      )}

      {/* Identity. Sits in the upper third rather than dead centre, so it never
          collides with the controls and reads the way WhatsApp does. */}
      {!showRemoteVideo && (
        <View style={[s.who, { paddingTop: insets.top + 72 }]}>
          <Avatar name={call.name} uri={call.avatar} size={128} />
          <Text style={s.name} numberOfLines={1}>{call.name || 'Unknown'}</Text>
          <Text style={s.status}>{statusLabel(call)}</Text>
        </View>
      )}

      {/* On video, the same information collapses to a compact heads-up line. */}
      {showRemoteVideo && controlsUp && (
        <Animated.View style={[s.videoHud, { top: insets.top + SPACING.screen, opacity: fade }]}>
          <Text style={s.videoName} numberOfLines={1}>{call.name || 'Unknown'}</Text>
          <Text style={s.videoStatus}>{statusLabel(call)}</Text>
        </Animated.View>
      )}

      {showLocalVideo && (
        <View style={[s.selfWrap, { top: insets.top + SPACING.xl }]}>
          <RTCView
            streamURL={localStream.toURL()}
            style={s.self}
            objectFit="cover"
            mirror
            zOrder={1}
          />
        </View>
      )}

      <Animated.View
        style={[
          s.controls,
          { paddingBottom: insets.bottom + (incoming ? 56 : 34), opacity: showRemoteVideo ? fade : 1 },
        ]}
        pointerEvents={showRemoteVideo && !controlsUp ? 'none' : 'auto'}
      >
        {incoming ? (
          <View style={s.answerRow}>
            <RoundBtn icon="call" tone="danger" size="lg" rotate label="Decline"
              onPress={() => callEngine.reject()} />
            <RoundBtn icon={video ? 'videocam' : 'call'} tone="accept" size="lg" label="Accept"
              onPress={() => callEngine.accept()} />
          </View>
        ) : (
          <View style={s.ctrlRow}>
            <RoundBtn
              icon={muted ? 'mic-off' : 'mic'}
              tone={muted ? 'active' : 'glass'}
              onPress={() => callEngine.toggleMute()}
              a11y={muted ? 'Unmute' : 'Mute'}
            />
            {video && (
              <RoundBtn
                icon={camOff ? 'videocam-off' : 'videocam'}
                tone={camOff ? 'active' : 'glass'}
                onPress={() => callEngine.toggleCam()}
                a11y={camOff ? 'Turn camera on' : 'Turn camera off'}
              />
            )}
            {video && !camOff && (
              <RoundBtn icon="camera-reverse" tone="glass"
                onPress={() => callEngine.switchCamera()} a11y="Switch camera" />
            )}
            <RoundBtn icon="call" tone="danger" rotate
              onPress={() => callEngine.hangup()} a11y="End call" />
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

// One button component for every state. `active` inverts to a white fill, which
// is how WhatsApp shows mute/camera-off engaged — far clearer than a text label.
function RoundBtn({ icon, tone, onPress, label, a11y, rotate = false, size = 'md' }) {
  const lg = size === 'lg';
  const dim = lg ? 68 : 58;
  const bg =
    tone === 'danger' ? '#E5352B'
      : tone === 'accept' ? '#12B76A'
        : tone === 'active' ? '#FFFFFF'
          : 'rgba(255,255,255,0.18)';
  const fg = tone === 'active' ? '#10161F' : '#FFFFFF';
  return (
    <View style={s.ctrlWrap}>
      <TouchableOpacity
        style={[s.ctrl, { width: dim, height: dim, borderRadius: dim / 2, backgroundColor: bg }]}
        onPress={onPress}
        activeOpacity={0.82}
        accessibilityRole="button"
        accessibilityLabel={a11y || label}
      >
        <Ionicons
          name={icon}
          size={lg ? 30 : 25}
          color={fg}
          style={rotate ? { transform: [{ rotate: '135deg' }] } : null}
        />
      </TouchableOpacity>
      {!!label && <Text style={s.ctrlLabel}>{label}</Text>}
    </View>
  );
}

const s = themed(() => ({
  // elevation as well as zIndex: on Android a sibling with its own elevation can
  // otherwise paint over this however late it sits in the tree.
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0B1017',
    justifyContent: 'space-between',
    zIndex: 2000, elevation: 2000,
  },

  // The blown-up avatar behind the blur. Centred and clipped; it is wallpaper,
  // not content, so it is deliberately allowed to overflow.
  blurHost: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  // Blur alone leaves light avatars too bright for white text to sit on.
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,12,18,0.55)' },

  who: { alignItems: 'center', paddingHorizontal: SPACING.xl, gap: SPACING.xs },
  name: {
    fontSize: 26, fontWeight: '700', color: '#FFFFFF',
    marginTop: SPACING.xl, textAlign: 'center',
  },
  status: { fontSize: 15, color: 'rgba(255,255,255,0.72)', marginTop: 2 },

  videoHud: {
    position: 'absolute', left: SPACING.xl, right: SPACING.xl,
    alignItems: 'center',
  },
  videoName: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  videoStatus: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  selfWrap: {
    position: 'absolute', right: SPACING.screen,
    width: 104, height: 150,
    borderRadius: RADIUS.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: '#000',
  },
  self: { flex: 1 },

  controls: { paddingHorizontal: SPACING.xl },
  // In-call controls sit close together as one cluster; answer/decline are pushed
  // apart so the wrong one is hard to hit in a hurry.
  ctrlRow: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.xl },
  answerRow: { flexDirection: 'row', justifyContent: 'space-evenly' },

  ctrlWrap: { alignItems: 'center', gap: SPACING.sm },
  ctrl: {
    alignItems: 'center', justifyContent: 'center',
    ...(Platform.OS === 'android' ? { elevation: 6 } : {}),
  },
  ctrlLabel: { fontSize: 12.5, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
}));
