// CONTACT / GROUP INFO — what opens when you tap the name in a thread header.
//
// /chat/contact_info returns two different shapes depending on is_group, so this
// screen genuinely renders two layouts off one payload:
//   group → description, members (with admin badges), permissions, leave
//   1:1   → mobile, role, about, nickname, block
// Everything shared (avatar, media, mute, favourite, disappearing, clear) is
// rendered once above the split.
//
// Laid out like WhatsApp: centred hero → action circles → media row → stacked
// cards. The card/row/hero/member shapes are shared with GroupManageScreen via
// components/ui/InfoSection, so a change to the look lands on both screens.
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Alert, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, RADIUS, SPACING, themed } from '../theme';
import {
  Screen, ScreenHeader, Loader, EmptyState, Avatar, PopupModal, Switch,
  ConfirmDialog, InfoSection, InfoRow, InfoHero, MemberRow,
} from '../components/ui';
import AuthImage from '../components/chat/AuthImage';
import VideoThumb from '../components/chat/VideoThumb';
import MuteSheet, { mutedUntilLabel } from '../components/chat/MuteSheet';
import usePlaceCall from '../hooks/usePlaceCall';
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

// How many thumbnails the media row previews. WhatsApp shows a short strip and
// puts the rest behind the chevron; /chat/media_list has no limit param, so the
// full (capped) list comes back and we slice.
const STRIP = 4;

// The circle actions under the name. Audio and Video place REAL calls — they used
// to open a Google Meet instead, from a time when the app had no WebRTC. It does
// now, so they were a bug: the one place you would look to ring someone quietly
// created a meeting link. Meet is still reachable from the thread's ⋮ "Start a
// meeting", which is also where the web keeps it.
function Circle({ icon, label, onPress, disabled }) {
  return (
    <TouchableOpacity
      style={s.circleWrap} onPress={onPress} activeOpacity={0.7} disabled={!onPress || disabled}
    >
      <View style={[s.circle, disabled && s.circleOff]}>
        <Ionicons name={icon} size={21} color={disabled ? COLORS.faint : COLORS.primary} />
      </View>
      <Text style={[s.circleTxt, disabled && { color: COLORS.faint }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function ContactInfoScreen({
  conversation, onBack, onLeft, onManageGroup, onOpenChat, onOpenMedia,
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
  const [strip, setStrip] = useState([]);       // recent media thumbnails
  const [confirm, setConfirm] = useState(null); // { title, message, icon, actions }
  const [muteAsk, setMuteAsk] = useState(false);
  const [nickOpen, setNickOpen] = useState(false);
  const [nickDraft, setNickDraft] = useState('');

  // Clearing the field removes the nickname — the server treats '' as "unset",
  // which is how the web's Save button behaves too.
  const saveNick = async () => {
    setNickOpen(false);
    const nick = nickDraft.trim();
    try {
      await chat.setNickname(info.userId, nick);
      setInfo((p) => ({ ...p, nickname: nick }));
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Could not save the nickname.');
    }
  };

  // blockedByMe comes from /chat/contact_info, which is fresher than the
  // conversation row this screen was opened with — and it is the one field that
  // decides whether calling is allowed at all, so prefer it once loaded.
  const { placeCall, callErr, clearCallErr } = usePlaceCall({
    ...conversation,
    blockedByMe: info ? info.blockedByMe : conversation?.blockedByMe,
  });

  // Shown for any 1:1 you are in. Not gated on the WebRTC module: hiding the
  // buttons on a build without it looks like the feature was removed, so
  // placeCall says so instead. Same reasoning as the thread header.
  const showCall = !!info && !info.isGroup && !info.isSelf && !info.blockedByMe;

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

  // The strip is decoration: a failure leaves the row showing counts only, which
  // is still a working "show all" affordance, so it never surfaces an error.
  useEffect(() => {
    let alive = true;
    if (!convId) return undefined;
    chat.fetchMediaList(convId, 'media')
      .then((items) => { if (alive) setStrip((items || []).slice(0, STRIP)); })
      .catch((e) => log.warn('media strip failed', e?.message));
    return () => { alive = false; };
  }, [convId]);

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

  const confirmClear = () => setConfirm({
    title: 'Clear chat?',
    message: 'Messages will be hidden for you. Everyone else keeps their copy.',
    icon: 'trash-outline',
    actions: [{
      key: 'clear', label: 'Clear chat', tone: 'danger',
      onPress: async () => {
        setConfirm(null);
        try { await chat.clearChat(convId); }
        catch (e) { Alert.alert('Failed', e?.message || 'Could not clear the chat.'); }
      },
    }],
  });

  const confirmLeave = () => {
    const group = info?.isGroup;
    setConfirm({
      title: group ? 'Exit group?' : 'Delete chat?',
      message: group
        ? 'You will stop receiving messages from this group.'
        : 'The chat disappears from your list. It comes back if they message you again.',
      icon: 'exit-outline',
      actions: [{
        key: 'leave', label: group ? 'Exit group' : 'Delete chat', tone: 'danger',
        onPress: async () => {
          setConfirm(null);
          try { await chat.leaveChat(convId); onLeft?.(); }
          catch (e) { Alert.alert('Failed', e?.message || 'Please try again.'); }
        },
      }],
    });
  };

  const toggleBlock = () => {
    const next = !info.blockedByMe;
    setConfirm({
      title: next ? `Block ${info.name}?` : `Unblock ${info.name}?`,
      message: next
        ? 'They will not be able to message or call you, and neither of you will see the other online.'
        : 'They will be able to message you again.',
      icon: next ? 'ban-outline' : 'lock-open-outline',
      tone: next ? 'danger' : 'primary',
      actions: [{
        key: 'block', label: next ? 'Block' : 'Unblock', tone: next ? 'danger' : 'primary',
        onPress: async () => {
          setConfirm(null);
          try {
            const blocked = await chat.blockUser(info.userId, next);
            setInfo((p) => ({ ...p, blockedByMe: blocked }));
          } catch (e) { Alert.alert('Failed', e?.message || 'Please try again.'); }
        },
      }],
    });
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
        <ScreenHeader title="Details" onBack={onBack} />
        <EmptyState icon="alert-circle-outline" tone="error" title={error || 'Not found'} onRetry={load} />
      </Screen>
    );
  }

  const disappearLabel = (DISAPPEAR.find((d) => d.seconds === info.disappearSeconds) || DISAPPEAR[0]).label;
  const media = info.media || {};
  const mediaTotal = (media.photos || 0) + (media.videos || 0) + (media.docs || 0);

  // Presence now ships with /chat/contact_info, so it is fresh as of this screen
  // opening. The conversation row — a snapshot from whenever the list was last
  // polled — is only a fallback for a server that predates the field. An empty
  // result is a legitimate answer (privacy or a block withholds it), so render
  // nothing rather than "offline".
  const online = info.hasPresence ? info.online : conversation?.online;
  const lastSeen = info.hasPresence ? info.lastSeen : conversation?.lastSeen;
  const presence = info.isGroup || info.isSelf ? '' : presenceText({ online, lastSeen });

  return (
    <Screen>
      <ScreenHeader title={info.isGroup ? 'Group info' : 'Contact info'} onBack={onBack} />

      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <InfoHero
          name={info.title || info.name}
          uri={info.avatarUrl}
          title={info.title || info.name}
          sub={info.isGroup ? `${info.memberCount} members` : (info.mobile || info.role)}
        >
          {!!presence && (
            <Text style={[s.presence, online && s.presenceOn]}>{presence}</Text>
          )}
          {!info.isGroup && !!info.nickname && (
            <Text style={s.nickname}>Saved as “{info.nickname}”</Text>
          )}
          {info.isGroup && !!info.description && (
            <Text style={s.description}>{info.description}</Text>
          )}
        </InfoHero>

        {/* Circle actions. 1:1 only — a group already reaches Manage group below,
            and the web client gates its own circle row the same way. */}
        {!info.isGroup && !info.isSelf && (
          <View style={s.circles}>
            <Circle icon="chatbubble-outline" label="Message" onPress={onBack} />
            {showCall && (
              <>
                <Circle icon="call-outline" label="Audio" onPress={() => placeCall(false)} disabled={busy} />
                <Circle icon="videocam-outline" label="Video" onPress={() => placeCall(true)} disabled={busy} />
              </>
            )}
          </View>
        )}

        {/* Nickname — private, 1:1 only. The screen has always DISPLAYED one in
            the hero above; chat.setNickname existed with no caller, so there was
            no way to actually set it from the app. */}
        {!info.isGroup && !info.isSelf && !!info.userId && (
          <InfoSection>
            <InfoRow
              icon="pricetag-outline"
              label={info.nickname ? 'Change nickname' : 'Add nickname'}
              sub={info.nickname || 'Only you see this'}
              onPress={() => { setNickDraft(info.nickname || ''); setNickOpen(true); }}
              chevron last
            />
          </InfoSection>
        )}

        {/* Media, links and docs — the counts used to be three dead tiles. */}
        <InfoSection>
          <InfoRow
            icon="images-outline" label="Media, links and docs"
            sub={`${media.photos || 0} photos · ${media.videos || 0} videos · ${media.docs || 0} docs`}
            onPress={onOpenMedia}
            right={<Text style={s.count}>{mediaTotal}</Text>}
            chevron={!!onOpenMedia}
            last={!strip.length}
          />
          {!!strip.length && (
            <TouchableOpacity style={s.strip} onPress={onOpenMedia} activeOpacity={0.8} disabled={!onOpenMedia}>
              {strip.map((it) => (
                <View key={it.id} style={s.thumb}>
                  {/* /chats_369/media/<id> is auth='user' and RN's image pipeline
                      has its own cookie jar — AuthImage is the only way in. */}
                  {it.kind === 'video' ? (
                    <VideoThumb style={s.thumbImg} iconSize={12} />
                  ) : (
                    <AuthImage uri={it.url} id={it.id} mimetype={it.mimetype} style={s.thumbImg} />
                  )}
                </View>
              ))}
            </TouchableOpacity>
          )}
        </InfoSection>

        {!info.isGroup && !!info.about && (
          <InfoSection title="About">
            <InfoRow icon="information-circle-outline" label={info.about} last />
          </InfoSection>
        )}

        <InfoSection>
          {/* Muting asks for how long; un-muting is immediate. This used to pass
              hours=0 (forever) whichever way the switch moved. */}
          <InfoRow
            icon="notifications-off-outline" label="Mute notifications"
            // The deadline the user picked, echoed back. Without this a mute was
            // a switch with no memory — you could not tell 8 hours from forever.
            sub={info.muted ? mutedUntilLabel(info.mutedUntil) : undefined}
            right={(
              <Switch
                value={!!info.muted}
                onValueChange={(v) => {
                  if (v) setMuteAsk(true);
                  else toggle('muted', () => chat.muteConversation(convId, false, 0));
                }}
              />
            )}
          />
          <InfoRow
            icon="star-outline" label="Favourite"
            right={<Switch value={!!info.favourite} onValueChange={() => toggle('favourite', (v) => chat.favouriteConversation(convId, v))} />}
          />
          <InfoRow
            icon="timer-outline" label="Disappearing messages" sub={disappearLabel}
            onPress={() => setDisappearOpen(true)} chevron last
          />
        </InfoSection>

        {info.isGroup ? (
          <>
            <InfoSection>
              <InfoRow
                icon="settings-outline" label="Manage group"
                sub={info.isAdmin ? 'You are an admin' : 'Name, members and permissions'}
                onPress={onManageGroup} chevron last
              />
            </InfoSection>
            <InfoSection title={`${info.members?.length || 0} members`}>
              {(info.members || []).map((m, i) => (
                <MemberRow
                  key={m.id}
                  name={m.name} uri={m.avatarUrl} meta={m.mobile}
                  you={m.id === info.meId} admin={m.isAdmin}
                  onPress={() => setMember(m)}
                  last={i === (info.members.length - 1)}
                />
              ))}
            </InfoSection>
          </>
        ) : (
          <InfoSection>
            <InfoRow icon="call-outline" label={info.mobile || 'No number on file'} />
            <InfoRow icon="person-outline" label={`Role · ${info.role}`} last />
          </InfoSection>
        )}

        <InfoSection>
          <InfoRow
            icon="trash-outline" label="Clear chat" onPress={confirmClear}
            last={info.isSelf}
          />
          {!info.isGroup && !info.isSelf && (
            <InfoRow
              icon={info.blockedByMe ? 'lock-open-outline' : 'ban-outline'}
              label={info.blockedByMe ? `Unblock ${info.name}` : `Block ${info.name}`}
              tone="danger" onPress={toggleBlock}
            />
          )}
          {!info.isSelf && (
            <InfoRow
              icon="exit-outline"
              label={info.isGroup ? 'Exit group' : 'Delete chat'}
              tone="danger" onPress={confirmLeave} last
            />
          )}
        </InfoSection>
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

      <ConfirmDialog
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        icon={confirm?.icon}
        tone={confirm?.tone || 'danger'}
        actions={confirm?.actions || []}
        onCancel={() => setConfirm(null)}
      />

      <PopupModal visible={nickOpen} onClose={() => setNickOpen(false)} title="Nickname">
        <Text style={s.nickHint}>
          Only you see this. It replaces {info.name} throughout your chats.
        </Text>
        <TextInput
          style={s.nickInput}
          value={nickDraft}
          onChangeText={setNickDraft}
          placeholder={info.name}
          placeholderTextColor={COLORS.faint}
          autoFocus
          maxLength={64}
          returnKeyType="done"
          onSubmitEditing={saveNick}
        />
        <View style={s.nickBtns}>
          {/* Clearing is the documented way to remove one, so it needs its own
              affordance rather than relying on the user emptying the field. */}
          <TouchableOpacity onPress={() => { setNickDraft(''); }} activeOpacity={0.75}>
            <Text style={s.nickClear}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={saveNick} activeOpacity={0.85} style={s.nickSave}>
            <Text style={s.nickSaveTxt}>Save</Text>
          </TouchableOpacity>
        </View>
      </PopupModal>

      <MuteSheet
        visible={muteAsk}
        onClose={() => setMuteAsk(false)}
        onPick={async (hours, opt) => {
          setMuteAsk(false);
          // Optimistic, including the deadline, so the row's subtitle updates
          // immediately. hours 0 = no deadline. The server format is a naive
          // UTC string, so match it rather than sending an ISO one.
          const until = hours
            ? new Date(Date.now() + hours * 3600000).toISOString().slice(0, 19).replace('T', ' ')
            : null;
          setInfo((p) => ({ ...p, muted: true, mutedUntil: until }));
          try {
            await chat.muteConversation(convId, true, hours);
            Alert.alert('Muted', `Notifications are off ${opt.confirm}.`);
          } catch (e) {
            Alert.alert('Failed', e?.message || 'Could not mute.');
            load();
          }
        }}
      />

      {/* Same treatment as the thread: a failed call is a thing to tell the user,
          not a reason to replace the screen with an error state. */}
      <ConfirmDialog
        visible={!!callErr}
        icon="call-outline"
        tone="danger"
        title="Can't start the call"
        message={callErr || ''}
        actions={[]}
        cancelLabel="OK"
        onCancel={clearCallErr}
      />
    </Screen>
  );
}

const s = themed((C) => ({
  presence: { fontSize: 12.5, color: C.slate500, fontWeight: '600' },
  presenceOn: { color: C.green, fontWeight: '700' },
  nickname: { fontSize: 12.5, color: C.faint, fontStyle: 'italic' },
  nickHint: { fontSize: 12.5, color: C.slate500, paddingHorizontal: SPACING.sm, marginBottom: SPACING.sm },
  nickInput: {
    marginHorizontal: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: 10,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.line,
    fontSize: 15, color: C.slate700, backgroundColor: C.card,
  },
  nickBtns: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    gap: SPACING.lg, paddingHorizontal: SPACING.sm, paddingTop: SPACING.md,
  },
  nickClear: { fontSize: 14, fontWeight: '700', color: C.slate500 },
  nickSave: {
    paddingHorizontal: SPACING.lg, paddingVertical: 9,
    borderRadius: RADIUS.md, backgroundColor: C.primary,
  },
  nickSaveTxt: { fontSize: 14, fontWeight: '800', color: C.onPrimary },
  description: { fontSize: 13.5, color: C.slate500, textAlign: 'center', paddingHorizontal: 30, marginTop: 4 },

  circles: {
    flexDirection: 'row', justifyContent: 'center', gap: SPACING.xl * 1.6,
    marginBottom: SPACING.xl,
  },
  circleWrap: { alignItems: 'center', gap: SPACING.xs },
  circle: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: COLORS.tintBg,
    alignItems: 'center', justifyContent: 'center',
  },
  circleOff: { backgroundColor: COLORS.slate100 },
  circleTxt: { fontSize: 12, fontWeight: '700', color: C.primary },

  count: { fontSize: 13.5, fontWeight: '700', color: C.slate500 },
  strip: { flexDirection: 'row', gap: 3, paddingHorizontal: 3, paddingBottom: 3 },
  thumb: { flex: 1, aspectRatio: 1, borderRadius: RADIUS.sm, overflow: 'hidden', backgroundColor: COLORS.slate100 },
  thumbImg: { width: '100%', height: '100%' },
  play: {
    position: 'absolute', right: 4, bottom: 4,
    width: 18, height: 18, borderRadius: 9, backgroundColor: C.scrim,
    alignItems: 'center', justifyContent: 'center',
  },

  pick: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl, paddingVertical: SPACING.screen,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  pickTxt: { fontSize: 15, color: C.ink, fontWeight: '600' },
  pickNote: { fontSize: 11.5, color: C.faint, padding: SPACING.xl, lineHeight: 16 },

  memberHero: { alignItems: 'center', gap: 4, paddingTop: SPACING.screen, paddingBottom: SPACING.md },
  memberHeroName: { fontSize: 16.5, fontWeight: '800', color: C.navy },
  memberHeroMeta: { fontSize: 12.5, color: C.slate500 },
  memberAction: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingHorizontal: SPACING.xl, paddingVertical: SPACING.screen,
    borderTopWidth: 1, borderTopColor: C.line,
  },
  memberActionTxt: { fontSize: 15, color: C.ink, fontWeight: '700' },
}));
