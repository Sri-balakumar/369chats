// PopupModal — the centred dialog.
//
// Springs in rather than cutting: a dialog that appears instantly reads as a
// glitch, so it scales from 0.92 and fades, and the scrim fades with it. Capped
// at 380pt wide and 78% tall so a long list scrolls inside the card instead of
// pushing the buttons off screen.
import React, { useRef, useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback,
  StyleSheet, Animated, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING, themed } from '../../theme';

export default function PopupModal({ visible, onClose, title, subtitle, children }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      speed: 18,
      bounciness: 6,
    }).start();
  }, [visible, anim]);

  const cardStyle = {
    opacity: anim,
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
  };

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop}>
          {/* Swallow taps on the card so it doesn't close under its own content. */}
          <TouchableWithoutFeedback onPress={() => {}}>
            <Animated.View style={[s.card, cardStyle]}>
              {!!title && (
                <View style={s.head}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.title} numberOfLines={1}>{title}</Text>
                    {!!subtitle && <Text style={s.subtitle} numberOfLines={2}>{subtitle}</Text>}
                  </View>
                  <TouchableOpacity
                    onPress={onClose}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    style={s.close}
                  >
                    <Ionicons name="close" size={18} color={COLORS.slate500} />
                  </TouchableOpacity>
                </View>
              )}
              {children}
            </Animated.View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const s = themed((C) => ({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 380, maxHeight: '78%',
    backgroundColor: COLORS.card, borderRadius: 20, overflow: 'hidden',
    paddingBottom: SPACING.sm,
    ...Platform.select({
      android: { elevation: 12 },
      default: {
        shadowColor: COLORS.slate900, shadowOpacity: 0.3,
        shadowRadius: 28, shadowOffset: { width: 0, height: 12 },
      },
    }),
  },
  head: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.md,
    paddingHorizontal: SPACING.xl, paddingTop: SPACING.xl, paddingBottom: SPACING.md,
  },
  title: { fontSize: 17.5, fontWeight: '900', color: C.navy },
  subtitle: { fontSize: 12.5, color: C.slate500, marginTop: 3, lineHeight: 17 },
  // Circular hit target rather than a bare glyph — easier to hit, reads as a button.
  close: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: C.slate100,
    alignItems: 'center', justifyContent: 'center',
  },
}));
