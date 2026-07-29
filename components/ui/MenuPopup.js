// MenuPopup — the overflow menu that drops from the ⋮ button, WhatsApp-style,
// rather than sliding up from the bottom.
//
// It anchors to the top-right by default because that is where the ⋮ lives in
// every header in this app. Pass `anchor={{top, right}}` to place it elsewhere.
// The scrim is a full-screen pressable so a tap anywhere outside closes it.
import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback,
  StyleSheet, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING, TOP, themed } from '../../theme';

export default function MenuPopup({ visible, onClose, items = [], anchor, width = 232 }) {
  // Sit just under the header row: the status-bar inset plus the 40pt button.
  const top = anchor?.top ?? TOP + 46;
  const right = anchor?.right ?? 12;

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.scrim}>
          {/* Swallow taps on the card itself so it doesn't close underneath. */}
          <TouchableWithoutFeedback onPress={() => {}}>
            <View style={[s.card, { top, right, width }]}>
              <ScrollView bounces={false} style={{ maxHeight: 420 }}>
                {items.filter(Boolean).map((it, i) => (
                  <TouchableOpacity
                    key={it.key || it.label}
                    style={[s.item, i === 0 && s.itemFirst]}
                    onPress={() => { onClose?.(); it.onPress?.(); }}
                    activeOpacity={0.65}
                  >
                    {!!it.icon && (
                      <Ionicons
                        name={it.icon} size={18}
                        color={it.tone === 'danger' ? COLORS.red : COLORS.slate500}
                      />
                    )}
                    <Text
                      style={[s.label, it.tone === 'danger' && { color: COLORS.red }]}
                      numberOfLines={1}
                    >
                      {it.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const s = themed((C) => ({
  // Barely-there scrim: the menu should feel attached to the header, not modal.
  scrim: { flex: 1, backgroundColor: 'rgba(15,23,42,0.18)' },
  card: {
    position: 'absolute',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    paddingVertical: 6,
    // A dropdown needs a stronger shadow than a card to read as floating.
    ...Platform.select({
      android: { elevation: 10 },
      default: {
        shadowColor: COLORS.slate900, shadowOpacity: 0.26,
        shadowRadius: 22, shadowOffset: { width: 0, height: 10 },
      },
    }),
  },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.screen,
    paddingHorizontal: SPACING.lg, paddingVertical: 13,
    marginHorizontal: 6, borderRadius: RADIUS.md,
  },
  itemFirst: {},
  label: { flex: 1, fontSize: 14.5, color: C.ink, fontWeight: '600' },
}));
