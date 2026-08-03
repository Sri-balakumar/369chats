// MUTE DURATION PICKER — "how long?", the way WhatsApp asks it.
//
// This lives here because there are three places to mute a chat (thread ⋮,
// chat-list row long-press, contact/group info) and only the thread ever asked.
// The other two silently passed hours=0 — mute forever — so the same action did
// two different things depending on where you tapped it.
//
// /chat/mute takes hours, where 0 means "until turned off". The server has always
// supported the durations below; only the UI was missing.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PopupModal } from '../ui';
import { COLORS, SPACING, themed } from '../../theme';

export const MUTE_FOR = [
  { hours: 8, label: '8 hours', sub: 'Until later today', icon: 'time-outline', confirm: 'for 8 hours' },
  { hours: 24, label: '1 day', sub: 'Until this time tomorrow', icon: 'today-outline', confirm: 'for 1 day' },
  { hours: 168, label: '1 week', sub: 'Until the same day next week', icon: 'calendar-outline', confirm: 'for a week' },
  { hours: 0, label: 'Always', sub: 'Until you turn it back on', icon: 'infinite-outline', confirm: 'until you turn them back on' },
];

// "Muted until 14 Aug, 18:30" — or the open-ended wording when there is no
// deadline. `mutedUntil` is null for a mute with no end, which is NOT the same
// as an unmuted chat, so callers must check `muted` before calling this.
export function mutedUntilLabel(mutedUntil) {
  if (!mutedUntil) return 'Muted until you turn it back on';
  const d = new Date(String(mutedUntil).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return 'Muted';
  if (d.getTime() <= Date.now()) return 'Mute expired';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString([], sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `Muted until ${date}, ${time}`;
}

// onPick(hours, option) — the caller owns the request and the failure message,
// because what to do afterwards differs per screen (the list reloads, the info
// screen flips a switch).
export default function MuteSheet({ visible, onClose, onPick, title = 'Mute notifications' }) {
  return (
    <PopupModal visible={visible} onClose={onClose} title={title}>
      <Text style={s.hint}>You will still see messages — they just won't make a sound.</Text>
      {MUTE_FOR.map((m) => (
        <TouchableOpacity
          key={m.label}
          style={s.row}
          activeOpacity={0.75}
          onPress={() => { onClose?.(); onPick?.(m.hours, m); }}
        >
          <View style={s.icon}>
            <Ionicons name={m.icon} size={18} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>{m.label}</Text>
            <Text style={s.sub}>{m.sub}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={COLORS.faint} />
        </TouchableOpacity>
      ))}
    </PopupModal>
  );
}

// PopupModal pads its HEADER by SPACING.xl but hands children the raw width, so
// anything here has to match that inset itself or it sits left of the title.
const PAD = SPACING.xl;

const s = themed((C) => StyleSheet.create({
  hint: {
    fontSize: 12.5, color: C.slate500, lineHeight: 17,
    paddingHorizontal: PAD, paddingBottom: SPACING.md,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingVertical: 12, paddingHorizontal: PAD,
  },
  icon: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.tintBg,
  },
  label: { fontSize: 15, color: C.ink, fontWeight: '700' },
  sub: { fontSize: 11.5, color: C.slate500, marginTop: 1 },
}));
