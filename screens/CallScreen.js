// The in-call / incoming-call surface.
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
// It owns no call state. callEngine is the single source of truth and pushes
// snapshots; this renders them and forwards button presses back.
import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Vibration, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RTCView } from 'react-native-webrtc';
import { Avatar } from '../components/ui';
import callEngine from '../services/callEngine';
import { COLORS, RADIUS, SPACING, themed } from '../theme';

// Ring pattern: buzz, pause, repeat. The second arg to Vibration.vibrate makes it
// loop, and it MUST be cancelled explicitly or it keeps going after the call ends.
const RING_PATTERN = [0, 700, 1200];

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

  if (!call) return null;

  const { video, status, muted, camOff, localStream, remoteStream } = call;
  const connected = status === 'connected';
  const showRemoteVideo = video && connected && !!remoteStream;
  const showLocalVideo = video && !camOff && !!localStream;

  return (
    <View style={[s.root, { paddingTop: insets.top + SPACING.xl, paddingBottom: insets.bottom + SPACING.xl }]}>
      {showRemoteVideo ? (
        <RTCView
          streamURL={remoteStream.toURL()}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          zOrder={0}
        />
      ) : null}

      {/* Identity block. Stays visible on a voice call and while a video call is
          still connecting, so there is never a blank screen with only buttons. */}
      {!showRemoteVideo && (
        <View style={s.who}>
          <Avatar name={call.name} uri={call.avatar} size={112} />
          <Text style={s.name} numberOfLines={1}>{call.name || 'Unknown'}</Text>
          <Text style={s.status}>{statusLabel(call)}</Text>
        </View>
      )}

      {showRemoteVideo && (
        <View style={[s.videoHud, { top: insets.top + SPACING.screen }]}>
          <Text style={s.videoName} numberOfLines={1}>{call.name || 'Unknown'}</Text>
          <Text style={s.videoStatus}>{statusLabel(call)}</Text>
        </View>
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

      <View style={s.controls}>
        {status === 'incoming' ? (
          <>
            <RoundBtn icon="close" tone="danger" label="Decline" onPress={() => callEngine.reject()} />
            <RoundBtn
              icon={video ? 'videocam' : 'call'}
              tone="accept"
              label="Accept"
              onPress={() => callEngine.accept()}
            />
          </>
        ) : (
          <>
            <RoundBtn
              icon={muted ? 'mic-off' : 'mic'}
              tone={muted ? 'on' : 'plain'}
              label={muted ? 'Unmute' : 'Mute'}
              onPress={() => callEngine.toggleMute()}
            />
            {video && (
              <RoundBtn
                icon={camOff ? 'videocam-off' : 'videocam'}
                tone={camOff ? 'on' : 'plain'}
                label={camOff ? 'Camera on' : 'Camera off'}
                onPress={() => callEngine.toggleCam()}
              />
            )}
            {video && !camOff && (
              <RoundBtn icon="camera-reverse" tone="plain" label="Flip" onPress={() => callEngine.switchCamera()} />
            )}
            <RoundBtn icon="call" tone="danger" label="End" rotate onPress={() => callEngine.hangup()} />
          </>
        )}
      </View>
    </View>
  );
}

function RoundBtn({ icon, tone, label, onPress, rotate = false }) {
  const bg =
    tone === 'danger' ? COLORS.red
      : tone === 'accept' ? COLORS.green
        : tone === 'on' ? COLORS.card
          : 'rgba(255,255,255,0.16)';
  const fg = tone === 'on' ? COLORS.ink : '#FFFFFF';
  return (
    <View style={s.ctrlWrap}>
      <TouchableOpacity
        style={[s.ctrl, { backgroundColor: bg }]}
        onPress={onPress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Ionicons
          name={icon}
          size={26}
          color={fg}
          style={rotate ? { transform: [{ rotate: '135deg' }] } : null}
        />
      </TouchableOpacity>
      <Text style={s.ctrlLabel}>{label}</Text>
    </View>
  );
}

const s = themed((C) => ({
  // elevation as well as zIndex: on Android a sibling with its own elevation can
  // otherwise paint over this however late it sits in the tree.
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.primaryDark || C.primary,
    alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl,
    zIndex: 2000, elevation: 2000,
  },

  who: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.md },
  name: {
    fontSize: 24, fontWeight: '900', color: '#FFFFFF',
    marginTop: SPACING.lg, textAlign: 'center',
  },
  status: { fontSize: 15, color: 'rgba(255,255,255,0.82)', fontWeight: '600' },

  videoHud: {
    position: 'absolute', left: SPACING.xl, right: SPACING.xl,
    alignItems: 'center',
  },
  videoName: { fontSize: 18, fontWeight: '900', color: '#FFFFFF' },
  videoStatus: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  selfWrap: {
    position: 'absolute', right: SPACING.screen,
    width: 104, height: 150,
    borderRadius: RADIUS.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: '#000',
  },
  self: { flex: 1 },

  controls: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center',
    gap: SPACING.xl, paddingTop: SPACING.xl,
  },
  ctrlWrap: { alignItems: 'center', gap: SPACING.xs, width: 76 },
  ctrl: {
    width: 62, height: 62, borderRadius: 31,
    alignItems: 'center', justifyContent: 'center',
    ...(Platform.OS === 'android' ? { elevation: 4 } : {}),
  },
  ctrlLabel: { fontSize: 11.5, color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
}));
