// Sheet — the bottom sheet: slides up, rounded top, grab handle, tap-scrim to
// dismiss.
//
// The nested pressables are deliberate: the outer catches scrim taps, the inner
// swallows taps on the sheet itself so content doesn't close it. The grab handle
// is also a tap target, because reaching for it to dismiss is instinctive.
import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback,
  KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { COLORS, RADIUS, SCRIM, SPACING, themed } from '../../theme';

export default function Sheet({ visible, onClose, title, subtitle, children }) {
  return (
    <Modal visible={!!visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={s.backdrop} />
        </TouchableWithoutFeedback>

        <View style={s.sheet}>
          <TouchableOpacity
            activeOpacity={0.6}
            onPress={onClose}
            style={s.handleZone}
            hitSlop={{ top: 8, bottom: 8, left: 40, right: 40 }}
          >
            <View style={s.handle} />
          </TouchableOpacity>

          {!!title && (
            <View style={s.head}>
              <Text style={s.title} numberOfLines={1}>{title}</Text>
              {!!subtitle && <Text style={s.subtitle} numberOfLines={2}>{subtitle}</Text>}
            </View>
          )}
          <View style={s.body}>{children}</View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = themed((C) => ({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: C.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '86%',
    backgroundColor: COLORS.card,
    borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet,
    paddingBottom: Platform.OS === 'ios' ? 30 : SPACING.xl,
    ...Platform.select({
      android: { elevation: 16 },
      default: {
        shadowColor: COLORS.slate900, shadowOpacity: 0.25,
        shadowRadius: 24, shadowOffset: { width: 0, height: -6 },
      },
    }),
  },
  handleZone: { alignItems: 'center', paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  handle: { width: 44, height: 4.5, borderRadius: 3, backgroundColor: COLORS.line },
  head: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md },
  title: { fontSize: 17.5, fontWeight: '900', color: C.navy },
  subtitle: { fontSize: 12.5, color: C.slate500, marginTop: 3, lineHeight: 17 },
  body: { paddingHorizontal: SPACING.xl },
}));
