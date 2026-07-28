// PopupModal — the centred dialog card: fades in, capped at 360pt wide and 70%
// tall, with a titled head bar and an ✕. Used for pickers and confirmations, where
// a bottom Sheet would be too heavy.
import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SCRIM } from '../../theme';

export default function PopupModal({ visible, onClose, title, children }) {
  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={s.sheet} activeOpacity={1}>
          {!!title && (
            <View style={s.head}>
              <Text style={s.title} numberOfLines={1}>{title}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.close}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
          {children}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: SCRIM, alignItems: 'center', justifyContent: 'center', padding: 26 },
  sheet: {
    width: '100%', maxWidth: 360, backgroundColor: '#fff', borderRadius: 20,
    maxHeight: '70%', paddingBottom: 12, overflow: 'hidden',
  },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.line,
  },
  title: { flex: 1, fontSize: 17, fontWeight: '800', color: COLORS.navy },
  close: { fontSize: 18, color: COLORS.muted, fontWeight: '700', paddingLeft: 12 },
});
