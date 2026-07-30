// InfoSection / InfoRow / InfoHero / MemberRow — the contact & group info vocabulary.
//
// ContactInfoScreen and GroupManageScreen render the same payload (/chat/contact_info)
// and had each grown their own copy of these four shapes, down to duplicated
// StyleSheet blocks. They live here so a change to the info look lands on both.
//
// The layout follows WhatsApp: a centred hero, then stacked white cards separated by
// a gap rather than by rules, with a neutral grey uppercase label above each group.
//
//   <InfoHero name={info.name} uri={info.avatarUrl} title={info.name} sub="12 members" />
//   <InfoSection title="3 members">
//     <MemberRow name="Asha" meta="98765 43210" admin onPress={...} last />
//   </InfoSection>
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOW, RADIUS, SPACING, themed } from '../../theme';
import Avatar from './Avatar';

// A white rounded card, optionally preceded by a section label. `right` puts an
// action (e.g. "Add") on the label line, which is why the label is a row.
export default function InfoSection({ title, right, children, style }) {
  return (
    <>
      {(!!title || !!right) && (
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>{title || ''}</Text>
          {right}
        </View>
      )}
      <View style={[s.card, style]}>{children}</View>
    </>
  );
}

// One line in a card: leading icon, label (+ optional sub), and a right slot.
// Non-tappable when `onPress` is omitted — several rows are pure display.
// `last` drops the divider so the final row doesn't rule against the card edge.
export function InfoRow({
  icon, label, sub, onPress, tone, right, chevron, last, disabled,
}) {
  const danger = tone === 'danger';
  const dim = disabled && !danger;
  return (
    <TouchableOpacity
      style={[s.row, last && s.rowLast]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress || disabled}
    >
      {!!icon && (
        <Ionicons
          name={icon} size={20}
          color={danger ? COLORS.red : (dim ? COLORS.faint : COLORS.primary)}
        />
      )}
      <View style={{ flex: 1 }}>
        <Text style={[s.rowTxt, danger && { color: COLORS.red }, dim && { color: COLORS.muted }]}>
          {label}
        </Text>
        {!!sub && <Text style={s.rowSub}>{sub}</Text>}
      </View>
      {right}
      {chevron && <Ionicons name="chevron-forward" size={18} color={COLORS.faint} />}
    </TouchableOpacity>
  );
}

// The centred block at the top. `children` is for the extra lines each screen adds
// (presence, about, nickname, description) — they differ per screen and per payload.
export function InfoHero({ name, uri, size = 104, title, sub, children }) {
  return (
    <View style={s.hero}>
      <Avatar name={name} uri={uri} size={size} />
      <Text style={s.heroName} numberOfLines={2}>{title}</Text>
      {!!sub && <Text style={s.heroSub}>{sub}</Text>}
      {children}
    </View>
  );
}

// A member of a group. `you` appends "(You)" rather than taking the id comparison,
// so the row stays presentational.
export function MemberRow({ name, uri, meta, you, admin, onPress, right, last }) {
  return (
    <TouchableOpacity
      style={[s.member, last && s.rowLast]}
      activeOpacity={onPress ? 0.7 : 1}
      onPress={onPress}
      disabled={!onPress}
    >
      <Avatar name={name} uri={uri} size={40} />
      <View style={{ flex: 1 }}>
        <Text style={s.memberName} numberOfLines={1}>{name}{you ? ' (You)' : ''}</Text>
        {!!meta && <Text style={s.memberMeta}>{meta}</Text>}
      </View>
      {admin && <View style={s.adminPill}><Text style={s.adminTxt}>Admin</Text></View>}
      {right}
    </TouchableOpacity>
  );
}

const s = themed((C) => ({
  hero: { alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.sm },
  heroName: { fontSize: 21, fontWeight: '900', color: C.navy, textAlign: 'center', paddingHorizontal: 30 },
  heroSub: { fontSize: 14, color: C.slate500, fontWeight: '600' },

  card: {
    marginHorizontal: SPACING.screen, marginBottom: SPACING.screen,
    backgroundColor: COLORS.card, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: C.line,
    overflow: 'hidden', ...SHADOW,
  },
  // Neutral grey, not the brand accent — an accent-coloured heading reads as a
  // branded settings list rather than a contact card.
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl, marginBottom: SPACING.sm,
  },
  sectionTitle: { fontSize: 12.5, fontWeight: '900', color: C.muted, letterSpacing: 0.8, textTransform: 'uppercase' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.screen,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.screen,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowTxt: { fontSize: 15, fontWeight: '700', color: C.ink },
  rowSub: { fontSize: 12.5, color: C.slate500, marginTop: 2 },

  member: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  memberName: { fontSize: 14.5, fontWeight: '700', color: C.ink },
  memberMeta: { fontSize: 12, color: C.slate500, marginTop: 1 },
  adminPill: { backgroundColor: COLORS.slate50, borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 3 },
  adminTxt: { fontSize: 10.5, fontWeight: '900', color: C.primary },
}));
