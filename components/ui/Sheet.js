// Sheet — the bottom sheet: slides up, 22px top radii, a grab handle, and a
// tap-the-scrim-to-dismiss backdrop.
//
// The nested TouchableOpacity is deliberate — the outer one catches scrim taps,
// the inner one swallows taps on the sheet itself so they don't close it.
// KeyboardAvoidingView is included because these sheets usually hold a form.
import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { COLORS, RADIUS, SCRIM, SPACING } from '../../theme';

export default function Sheet({ visible, onClose, title, children }) {
  return (
    <Modal visible={!!visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={s.sheet}>
            <View style={s.handle} />
            {!!title && <Text style={s.title}>{title}</Text>}
            {children}
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: SCRIM, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet,
    padding: 18, paddingBottom: 26,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#D5DCE8', marginBottom: SPACING.screen,
  },
  title: { fontSize: 18, fontWeight: '900', color: COLORS.navy, marginBottom: SPACING.sm },
});
