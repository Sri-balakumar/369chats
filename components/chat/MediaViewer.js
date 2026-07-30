// MediaViewer — full-screen viewer for a chat attachment.
//
// Images and video play INSIDE the app (video via components/chat/VideoStage, on
// expo-video). Audio and documents are still downloaded and handed to the OS,
// where the platform viewer is genuinely better than anything worth building
// here — and voice notes already play inline in the thread via AudioBubble.
//
// The media route is auth='user', so every fetch here relies on the Odoo session
// cookie in the platform cookie store — the same one <Image> uses. A logged-out
// app gets a blank frame rather than a 404 page.
import React, { useState } from 'react';
import {
  Modal, View, Text, Image, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Dimensions, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AuthImage from './AuthImage';
import VideoStage from './VideoStage';
import { COLORS, RADIUS, SPACING, themed } from '../../theme';
import openAttachment from '../../utils/openAttachment';
import { createLogger } from '../../api/logger';

const log = createLogger('MediaViewer');

const { width: SW, height: SH } = Dimensions.get('window');

export default function MediaViewer({ visible, message, onClose }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!message) return null;
  const isImage = message.kind === 'image';
  const isVideo = message.kind === 'video';

  // Download once into cache, then let the OS open or share it. The download +
  // hand-off live in utils/openAttachment, shared with the thread's tap-to-run.
  const openExternally = async ({ share = false } = {}) => {
    if (!message.mediaUrl) return;
    setBusy(true);
    try {
      await openAttachment(message, { share });
    } catch (e) {
      log.warn('open failed', e?.message);
      Alert.alert('Could not open', e?.message || 'The file could not be opened.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.root}>
        <View style={s.bar}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={26} color={COLORS.onOverlay} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{message.fileName || message.authorName}</Text>
            <Text style={s.sub} numberOfLines={1}>{message.authorName}</Text>
          </View>
          {/* No share on a view-once file — saving or forwarding it would defeat
              the entire point of sending it that way. */}
          {!message.viewOnce && (
            <TouchableOpacity
              onPress={() => openExternally({ share: true })}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              disabled={busy}
            >
              <Ionicons name="share-outline" size={23} color={COLORS.onOverlay} />
            </TouchableOpacity>
          )}
        </View>

        <View style={s.body}>
          {isVideo ? (
            <VideoStage
              message={message}
              style={s.video}
              onOpenExternally={() => openExternally()}
            />
          ) : isImage && !failed ? (
            // Cookie-authenticated route — see AuthImage for why a plain <Image>
            // renders an empty frame here.
            <AuthImage
              uri={message.mediaUrl}
              id={message.id}
              mimetype={message.mimetype}
              style={s.image}
              resizeMode="contain"
            />
          ) : (
            <View style={s.placeholder}>
              {/* Video never reaches here — it plays in VideoStage above. */}
              <Ionicons
                name={
                  message.kind === 'audio' ? 'musical-notes'
                    : failed ? 'alert-circle-outline' : 'document-text'
                }
                size={64} color={COLORS.onOverlay}
              />
              <Text style={s.placeholderTxt}>
                {failed
                  ? 'This image could not be loaded.'
                  : message.kind === 'audio' ? 'Voice message' : 'Document'}
              </Text>
              {!!message.fileName && <Text style={s.fileName} numberOfLines={2}>{message.fileName}</Text>}
              <TouchableOpacity style={s.openBtn} onPress={() => openExternally()} disabled={busy} activeOpacity={0.9}>
                {busy
                  ? <ActivityIndicator color={COLORS.onOverlay} />
                  : (
                    <>
                      <Ionicons name="open-outline" size={18} color={COLORS.onOverlay} />
                      <Text style={s.openTxt}>
                        {message.kind === 'audio' ? 'Play' : 'Open'}
                      </Text>
                    </>
                  )}
              </TouchableOpacity>
              <Text style={s.hint}>Opens in your device's default app.</Text>
            </View>
          )}
        </View>

        {!!message.body && (isImage || isVideo) && (
          <View style={s.caption}><Text style={s.captionTxt}>{message.body}</Text></View>
        )}
      </View>
    </Modal>
  );
}

const s = themed((C) => ({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.96)' },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.screen,
    paddingTop: Platform.OS === 'android' ? 44 : 58,
    paddingHorizontal: SPACING.screen, paddingBottom: SPACING.md,
  },
  title: { color: COLORS.onOverlay, fontSize: 15, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 1 },

  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: SW, height: SH * 0.7 },
  // Taller than the image: the native controls overlay the bottom of the surface,
  // so a 0.7 box would put the scrubber over the picture.
  video: { width: SW, height: SH * 0.78 },

  placeholder: { alignItems: 'center', gap: SPACING.lg, paddingHorizontal: 30 },
  placeholderTxt: { color: COLORS.onOverlay, fontSize: 17, fontWeight: '800' },
  fileName: { color: 'rgba(255,255,255,0.65)', fontSize: 13, textAlign: 'center' },
  openBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    marginTop: SPACING.sm, minWidth: 150, height: 46,
    borderRadius: RADIUS.lg, backgroundColor: C.primary,
  },
  openTxt: { color: COLORS.onOverlay, fontSize: 15, fontWeight: '800' },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 11.5 },

  caption: { paddingHorizontal: SPACING.xl, paddingBottom: 40, paddingTop: SPACING.md },
  captionTxt: { color: COLORS.onOverlay, fontSize: 14.5, textAlign: 'center' },
}));
