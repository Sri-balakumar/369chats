// ConfirmDialog — the app's own confirmation, for destructive choices.
//
// Deliberately NOT a React Native <Modal>. Every other overlay here (MenuPopup,
// PopupModal, Sheet) is one, and on Android opening a Modal from inside another
// Modal's onPress is a race the second one loses — it simply never appears.
// That is how "Delete" from the selection ⋮ ended up showing no confirmation at
// all. This renders as an absolutely-positioned layer inside the screen instead,
// so there is no second native window to lose the race.
//
// The other win: a native Alert follows the ANDROID theme, which is still pinned
// light, so it stays white even in dark mode. This follows the app's palette.
import React from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING, themed } from '../../theme';

export default function ConfirmDialog({
  visible,
  title,
  message,
  icon = 'alert-circle-outline',
  tone = 'danger',              // 'danger' | 'primary'
  actions = [],                 // [{ key, label, sub, tone, onPress }]
  cancelLabel = 'Cancel',
  onCancel,
}) {
  if (!visible) return null;
  const accent = tone === 'danger' ? COLORS.red : COLORS.primary;

  return (
    // elevation matters on Android: without it the layer can paint under
    // siblings that have their own elevation, however late it sits in the tree.
    <View style={s.root}>
      <Pressable style={s.scrim} onPress={onCancel} />
      <View style={s.card}>
        <View style={[s.iconWrap, { backgroundColor: tone === 'danger' ? COLORS.redBg : COLORS.tintBg }]}>
          <Ionicons name={icon} size={26} color={accent} />
        </View>
        <Text style={s.title}>{title}</Text>
        {!!message && <Text style={s.msg}>{message}</Text>}

        <View style={s.actions}>
          {actions.filter(Boolean).map((a) => (
            <TouchableOpacity
              key={a.key || a.label}
              style={[s.btn, a.tone === 'danger' ? s.btnDanger : s.btnPlain]}
              onPress={a.onPress}
              activeOpacity={0.85}
            >
              <Text style={[s.btnTxt, a.tone === 'danger' ? s.btnTxtDanger : s.btnTxtPlain]}>
                {a.label}
              </Text>
              {!!a.sub && <Text style={s.btnSub}>{a.sub}</Text>}
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={s.cancel} onPress={onCancel} activeOpacity={0.7}>
          <Text style={s.cancelTxt}>{cancelLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = themed((C) => ({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    padding: SPACING.xl,
    zIndex: 1000, elevation: 1000,
  },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: C.scrim },
  card: {
    width: '100%', maxWidth: 360,
    backgroundColor: C.card, borderRadius: RADIUS.sheet,
    borderWidth: 1, borderColor: C.line,
    paddingTop: SPACING.xl, paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md,
    alignItems: 'center',
    shadowColor: C.shadow, shadowOpacity: 0.3, shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 }, elevation: 24,
  },
  iconWrap: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg,
  },
  title: { fontSize: 17.5, fontWeight: '900', color: C.ink, textAlign: 'center' },
  msg: {
    fontSize: 13.5, color: C.muted, textAlign: 'center', lineHeight: 19.5,
    marginTop: SPACING.sm,
  },

  actions: { width: '100%', marginTop: SPACING.xl, gap: SPACING.sm },
  btn: {
    borderRadius: RADIUS.lg, paddingVertical: SPACING.lg, paddingHorizontal: SPACING.screen,
    alignItems: 'center',
  },
  btnDanger: { backgroundColor: C.redBg, borderWidth: 1, borderColor: C.redLine },
  btnPlain: { backgroundColor: C.slate50, borderWidth: 1, borderColor: C.line },
  btnTxt: { fontSize: 15, fontWeight: '800' },
  btnTxtDanger: { color: C.red },
  btnTxtPlain: { color: C.ink },
  btnSub: { fontSize: 11.5, color: C.muted, marginTop: 3, textAlign: 'center' },

  cancel: { paddingVertical: SPACING.screen, paddingHorizontal: SPACING.xl, marginTop: SPACING.xs },
  cancelTxt: { fontSize: 14.5, fontWeight: '800', color: C.slate500 },
}));
