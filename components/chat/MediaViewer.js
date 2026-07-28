// MediaViewer — full-screen viewer for a chat attachment.
//
// Images render inline. Video, audio and documents are DOWNLOADED and handed to
// the OS player/viewer instead, because this project has no media playback
// dependency: expo-av / expo-video are not installed, and adding one is a native
// module and therefore a new dev build. Handing off costs one tap and works today.
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
import { COLORS, RADIUS, SPACING } from '../../theme';
import openAttachment from '../../utils/openAttachment';
import { createLogger } from '../../api/logger';

const log = createLogger('MediaViewer');

const { width: SW, height: SH } = Dimensions.get('window');

export default function MediaViewer({ visible, message, onClose }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!message) return null;
  const isImage = message.kind === 'image';

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
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{message.fileName || message.authorName}</Text>
            <Text style={s.sub} numberOfLines={1}>{message.authorName}</Text>
          </View>
          <TouchableOpacity
            onPress={() => openExternally({ share: true })}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            disabled={busy}
          >
            <Ionicons name="share-outline" size={23} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={s.body}>
          {isImage && !failed ? (
            <Image
              source={{ uri: message.mediaUrl }}
              style={s.image}
              resizeMode="contain"
              onError={() => setFailed(true)}
            />
          ) : (
            <View style={s.placeholder}>
              <Ionicons
                name={
                  message.kind === 'video' ? 'videocam'
                    : message.kind === 'audio' ? 'musical-notes'
                      : failed ? 'alert-circle-outline' : 'document-text'
                }
                size={64} color="#fff"
              />
              <Text style={s.placeholderTxt}>
                {failed
                  ? 'This image could not be loaded.'
                  : message.kind === 'video' ? 'Video'
                    : message.kind === 'audio' ? 'Voice message' : 'Document'}
              </Text>
              {!!message.fileName && <Text style={s.fileName} numberOfLines={2}>{message.fileName}</Text>}
              <TouchableOpacity style={s.openBtn} onPress={() => openExternally()} disabled={busy} activeOpacity={0.9}>
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : (
                    <>
                      <Ionicons name="open-outline" size={18} color="#fff" />
                      <Text style={s.openTxt}>
                        {message.kind === 'video' || message.kind === 'audio' ? 'Play' : 'Open'}
                      </Text>
                    </>
                  )}
              </TouchableOpacity>
              <Text style={s.hint}>Opens in your device's default app.</Text>
            </View>
          )}
        </View>

        {!!message.body && isImage && (
          <View style={s.caption}><Text style={s.captionTxt}>{message.body}</Text></View>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.96)' },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.screen,
    paddingTop: Platform.OS === 'android' ? 44 : 58,
    paddingHorizontal: SPACING.screen, paddingBottom: SPACING.md,
  },
  title: { color: '#fff', fontSize: 15, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 1 },

  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: SW, height: SH * 0.7 },

  placeholder: { alignItems: 'center', gap: SPACING.lg, paddingHorizontal: 30 },
  placeholderTxt: { color: '#fff', fontSize: 17, fontWeight: '800' },
  fileName: { color: 'rgba(255,255,255,0.65)', fontSize: 13, textAlign: 'center' },
  openBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    marginTop: SPACING.sm, minWidth: 150, height: 46,
    borderRadius: RADIUS.lg, backgroundColor: COLORS.primary,
  },
  openTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 11.5 },

  caption: { paddingHorizontal: SPACING.xl, paddingBottom: 40, paddingTop: SPACING.md },
  captionTxt: { color: '#fff', fontSize: 14.5, textAlign: 'center' },
});
