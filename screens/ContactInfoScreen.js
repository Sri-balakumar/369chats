// CONTACT / GROUP INFO — what opens when you tap the name in a thread header.
//
// /chat/contact_info returns two different shapes depending on is_group, so this
// screen genuinely renders two layouts off one payload:
//   group → description, members (with admin badges), permissions, leave
//   1:1   → mobile, role, nickname, block
// Everything shared (avatar, media counts, mute, favourite, disappearing, clear)
// is rendered once above the split.
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SHADOW, RADIUS, SPACING, TOP, themed } from '../theme';
import { Screen, Loader, EmptyState, Avatar, PopupModal, Switch } from '../components/ui';
import * as chat from '../services/chat';
import presenceText from '../utils/presence';
import { createLogger } from '../api/logger';

const log = createLogger('ContactInfo');

// The only values /chat/set_disappear accepts — anything else is silently
// treated as "off", so the picker must not offer arbitrary durations.
const DISAPPEAR = [
  { seconds: 0, label: 'Off' },
  { seconds: 86400, label: '24 hours' },
  { seconds: 604800, label: '7 days' },
  { seconds: 7776000, label: '90 days' },
];

function Stat({ icon, value, label }) {
  return (
    <View style={s.stat}>
      <Ionicons name={icon} size={19} color={COLORS.primary} />
      <Text style={s.statVal}>{value}</Text>
      <Text style={s.statLbl}>{label}</Text>
    </View>
  );
}

function Action({ icon, label, onPress, tone, right, sub }) {
  const color = tone === 'danger' ? COLORS.red : COLORS.ink;
  return (
    <TouchableOpacity style={s.action} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}>
      <Ionicons name={icon} size={20} color={tone === 'danger' ? COLORS.red : COLORS.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[s.actionTxt, { color }]}>{label}</Text>
        {!!sub && <Text style={s.actionSub}>{sub}</Text>}
      </View>
      {right}
    </TouchableOpacity>
  );
}

export default function ContactInfoScreen({
  conversation, onBack, onLeft, onManageGroup, onOpenChat,
}) {
  // Edge-to-edge draws under the nav bar; reserve that space at the bottom.
  const insets = useSafeAreaInsets();
  const convId = conversation?.id;
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [disappearOpen, setDisappearOpen] = useState(false);
  const [member, setMember] = useState(null);   // tapped group member
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setInfo(await chat.contactInfo(convId));
    } catch (e) {
      log.warn('load failed', e?.message);
      setError(e?.message || 'Could not load details.');
    }
  }, [convId]);

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false); })(); }, [load]);

  // Optimistic toggles: flip locally, call, and reload on failure so the switch
  // never lies about server state.
  const toggle = async (key, fn) => {
    const next = !info[key];
    setInfo((p) => ({ ...p, [key]: next }));
    try { await fn(next); } catch (e) { Alert.alert('Failed', e?.message || 'Please try again.'); load(); }
  };

  const setDisappear = async (seconds) => {
    setDisappearOpen(false);
    try {
      await chat.setDisappear(convId, seconds);
      setInfo((p) => ({ ...p, disappearSeconds: seconds }));
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Could not change this.');
    }
  };

  const confirmClear = () => {
    Alert.alert('Clear chat?', 'Messages will be hidden for you. Everyone else keeps their copy.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          try { await chat.clearChat(convId); Alert.alert('Cleared', 'This chat has been cleared for you.'); }
          catch (e) { Alert.alert('Failed', e?.message || 'Could not clear the chat.'); }
        },
      },
    ]);
  };

  const confirmLeave = () => {
    const group = info?.isGroup;
    Alert.alert(
      group ? 'Exit group?' : 'Delete chat?',
      group ? 'You will stop receiving messages from this group.'
        : 'The chat disappears from your list. It comes back if they message you again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: group ? 'Exit' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            try { await chat.leaveChat(convId); onLeft?.(); }
            catch (e) { Alert.alert('Failed', e?.message || 'Please try again.'); }
          },
        },
      ],
    );
  };

  const toggleBlock = () => {
    const next = !info.blockedByMe;
    Alert.alert(
      next ? `Block ${info.name}?` : `Unblock ${info.name}?`,
      next ? 'They will not be able to message or call you, and neither of you will see the other online.' : '',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: next ? 'Block' : 'Unblock',
          style: next ? 'destructive' : 'default',
          onPress: async () => {
            try {
              const blocked = await chat.blockUser(info.userId, next);
              setInfo((p) => ({ ...p, blockedByMe: blocked }));
            } catch (e) { Alert.alert('Failed', e?.message || 'Please try again.'); }
          },
        },
      ],
    );
  };

  // Member actions. "Message" opens (or creates) the 1:1 with that person —
  // openDirect is get-or-create, so tapping it twice never makes a second chat.
  const messageMember = async () => {
    const m = member;
    setMember(null);
    if (!m || m.id === info.meId) return;
    setBusy(true);
    try {
      const conv = await chat.openDirect(m.id);
      onOpenChat?.(conv);
    } catch (e) {
      Alert.alert('Could not open chat', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const memberAdmin = async (action) => {
    const m = member;
    setMember(null);
    try {
      await chat.updateGroup(convId, action, { user_id: m.id });
      await load();
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Please try again.');
    }
  };

  if (loading) return <Screen><Loader /></Screen>;
  if (error || !info) {
    return (
      <Screen>
        <View style={[s.header, { paddingTop: TOP }]}>
          <TouchableOpacity onPress={onBack} style={s.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={24} color={COLORS.navy} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Details</Text>
          <View style={{ width: 40 }} />
        </View>
        <EmptyState icon="alert-circle-outline" tone="error" title={error || 'Not found'} onRetry={load} />
      </Screen>
    );
  }

  const disappearLabel = (DISAPPEAR.find((d) => d.seconds === info.disappearSeconds) || DISAPPEAR[0]).label;

  return (
    <Screen>
      <View style={[s.header, { paddingTop: TOP }]}>
        <TouchableOpacity onPress={onBack} style={s.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={COLORS.navy} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{info.isGroup ? 'Group info' : 'Contact info'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <Avatar name={info.title || info.name} uri={info.avatarUrl} size={104} />
          <Text style={s.name} numberOfLines={2}>{info.title || info.name}</Text>
          {info.isGroup
            ? <Text style={s.sub}>{info.memberCount} members</Text>
            : <Text style={s.sub}>{info.mobile || info.role}</Text>}
          {/* Presence comes from the conversation row, not /chat/contact_info —
              the server only serialises it there. Blank when privacy or a block
              withholds it, which is a real answer rather than missing data. */}
          {!info.isGroup && !info.isSelf && !!presenceText({
            online: conversation?.online, lastSeen: conversation?.lastSeen,
          }) && (
            <Text style={[s.presence, conversation?.online && s.presenceOn]}>
              {presenceText({ online: conversation?.online, lastSeen: conversation?.lastSeen })}
            </Text>
          )}
          {!info.isGroup && !!info.nickname && (
            <Text style={s.nickname}>Saved as “{info.nickname}”</Text>
          )}
          {info.isGroup && !!info.description && (
            <Text style={s.description}>{info.description}</Text>
          )}
        </View>

        <View style={s.statRow}>
          <Stat icon="image-outline" value={info.media?.photos ?? 0} label="Photos" />
          <Stat icon="videocam-outline" value={info.media?.videos ?? 0} label="Videos" />
          <Stat icon="document-outline" value={info.media?.docs ?? 0} label="Docs" />
        </View>

        <View style={s.card}>
          <Action
            icon="notifications-off-outline" label="Mute notifications"
            right={<Switch value={!!info.muted} onValueChange={() => toggle('muted', (v) => chat.muteConversation(convId, v, 0))} />}
          />
          <Action
            icon="star-outline" label="Favourite"
            right={<Switch value={!!info.favourite} onValueChange={() => toggle('favourite', (v) => chat.favouriteConversation(convId, v))} />}
          />
          <Action
            icon="timer-outline" label="Disappearing messages" sub={disappearLabel}
            onPress={() => setDisappearOpen(true)}
            right={<Ionicons name="chevron-forward" size={18} color={COLORS.faint} />}
          />
        </View>

        {info.isGroup ? (
          <>
            <View style={s.card}>
              <Action
                icon="settings-outline" label="Manage group"
                sub={info.isAdmin ? 'You are an admin' : 'Name, members and permissions'}
                onPress={onManageGroup}
                right={<Ionicons name="chevron-forward" size={18} color={COLORS.faint} />}
              />
            </View>
            <Text style={s.sectionTitle}>{info.members?.length || 0} members</Text>
            <View style={s.card}>
              {(info.members || []).map((m) => (
                <TouchableOpacity
                  key={m.id} style={s.member} activeOpacity={0.7}
                  onPress={() => setMember(m)}
                >
                  <Avatar name={m.name} uri={m.avatarUrl} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.memberName} numberOfLines={1}>
                      {m.name}{m.id === info.meId ? ' (You)' : ''}
                    </Text>
                    {!!m.mobile && <Text style={s.memberMeta}>{m.mobile}</Text>}
                  </View>
                  {m.isAdmin && <View style={s.adminPill}><Text style={s.adminTxt}>Admin</Text></View>}
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : (
          <View style={s.card}>
            <Action icon="call-outline" label={info.mobile || 'No number on file'} />
            <Action icon="person-outline" label={`Role · ${info.role}`} />
          </View>
        )}

        <View style={s.card}>
          <Action icon="trash-outline" label="Clear chat" onPress={confirmClear} />
          {!info.isGroup && !info.isSelf && (
            <Action
              icon={info.blockedByMe ? 'lock-open-outline' : 'ban-outline'}
              label={info.blockedByMe ? `Unblock ${info.name}` : `Block ${info.name}`}
              tone="danger" onPress={toggleBlock}
            />
          )}
          {!info.isSelf && (
            <Action
              icon="exit-outline"
              label={info.isGroup ? 'Exit group' : 'Delete chat'}
              tone="danger" onPress={confirmLeave}
            />
          )}
        </View>
      </ScrollView>

      {/* Tap a group member */}
      <PopupModal visible={!!member} onClose={() => setMember(null)} title={member?.name}>
        <View style={s.memberHero}>
          <Avatar name={member?.name} uri={member?.avatarUrl} size={64} />
          <Text style={s.memberHeroName} numberOfLines={1}>{member?.name}</Text>
          {!!member?.mobile && <Text style={s.memberHeroMeta}>{member.mobile}</Text>}
        </View>
        {member?.id !== info.meId && (
          <TouchableOpacity style={s.memberAction} onPress={messageMember} disabled={busy} activeOpacity={0.7}>
            <Ionicons name="chatbubble-outline" size={19} color={COLORS.primary} />
            <Text style={s.memberActionTxt}>Message {member?.name?.split(' ')[0]}</Text>
          </TouchableOpacity>
        )}
        {/* Promote/remove are admin-only server-side, so only an admin sees them. */}
        {info.isAdmin && member?.id !== info.meId && (
          <>
            <TouchableOpacity style={s.memberAction} onPress={() => memberAdmin('promote')} activeOpacity={0.7}>
              <Ionicons name="shield-checkmark-outline" size={19} color={COLORS.primary} />
              <Text style={s.memberActionTxt}>
                {member?.isAdmin ? 'Dismiss as admin' : 'Make group admin'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.memberAction} onPress={() => memberAdmin('remove')} activeOpacity={0.7}>
              <Ionicons name="person-remove-outline" size={19} color={COLORS.red} />
              <Text style={[s.memberActionTxt, { color: COLORS.red }]}>Remove from group</Text>
            </TouchableOpacity>
          </>
        )}
      </PopupModal>

      <PopupModal visible={disappearOpen} onClose={() => setDisappearOpen(false)} title="Disappearing messages">
        {DISAPPEAR.map((d) => (
          <TouchableOpacity key={d.seconds} style={s.pick} onPress={() => setDisappear(d.seconds)} activeOpacity={0.8}>
            <Text style={s.pickTxt}>{d.label}</Text>
            {info.disappearSeconds === d.seconds && <Ionicons name="checkmark" size={19} color={COLORS.primary} />}
          </TouchableOpacity>
        ))}
        <Text style={s.pickNote}>
          Applies to new messages only. Existing messages keep the timer they were sent with.
        </Text>
      </PopupModal>
    </Screen>
  );
}

const s = themed((C) => ({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: SPACING.md,
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', color: C.navy },
  iconBtn: {
    width: 40, height: 40, borderRadius: RADIUS.lg, backgroundColor: COLORS.card,
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },

  hero: { alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.sm },
  name: { fontSize: 21, fontWeight: '900', color: C.navy, textAlign: 'center', paddingHorizontal: 30 },
  sub: { fontSize: 14, color: C.slate500, fontWeight: '600' },
  nickname: { fontSize: 12.5, color: C.faint, fontStyle: 'italic' },
  presence: { fontSize: 12.5, color: C.slate500, fontWeight: '600' },
  presenceOn: { color: C.green, fontWeight: '700' },
  description: { fontSize: 13.5, color: C.slate500, textAlign: 'center', paddingHorizontal: 30, marginTop: 4 },

  statRow: {
    flexDirection: 'row', marginHorizontal: SPACING.screen, marginBottom: SPACING.screen,
    backgroundColor: COLORS.card, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: C.line, ...SHADOW,
  },
  stat: { flex: 1, alignItems: 'center', paddingVertical: SPACING.screen, gap: 2 },
  statVal: { fontSize: 17, fontWeight: '900', color: C.ink },
  statLbl: { fontSize: 11.5, color: C.slate500, fontWeight: '600' },

  card: {
    marginHorizontal: SPACING.screen, marginBottom: SPACING.screen,
    backgroundColor: COLORS.card, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: C.line,
    overflow: 'hidden', ...SHADOW,
  },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.screen,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.screen,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  actionTxt: { fontSize: 15, fontWeight: '700' },
  actionSub: { fontSize: 12.5, color: C.slate500, marginTop: 2 },

  sectionTitle: {
    fontSize: 12.5, fontWeight: '900', color: C.muted, letterSpacing: 0.8,
    paddingHorizontal: SPACING.xl, marginBottom: SPACING.sm, textTransform: 'uppercase',
  },
  member: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  memberName: { fontSize: 14.5, fontWeight: '700', color: C.ink },
  memberMeta: { fontSize: 12, color: C.slate500, marginTop: 1 },
  adminPill: { backgroundColor: COLORS.slate50, borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 3 },
  adminTxt: { fontSize: 10.5, fontWeight: '900', color: C.primary },

  pick: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl, paddingVertical: SPACING.screen,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  memberHero: { alignItems: 'center', gap: 4, paddingTop: SPACING.screen, paddingBottom: SPACING.md },
  memberHeroName: { fontSize: 16.5, fontWeight: '800', color: C.navy },
  memberHeroMeta: { fontSize: 12.5, color: C.slate500 },
  memberAction: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingHorizontal: SPACING.xl, paddingVertical: SPACING.screen,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line,
  },
  memberActionTxt: { fontSize: 15, color: C.ink, fontWeight: '700' },

  pickTxt: { fontSize: 15, color: C.ink, fontWeight: '600' },
  pickNote: { fontSize: 11.5, color: C.faint, padding: SPACING.xl, lineHeight: 16 },
}));
