// GROUP MANAGEMENT — rename, description, members, admins, permissions, invite.
//
// Every write goes through /chat/group/update (one route, seven actions) or
// /chat/group/permissions. The server gates each action differently:
//   rename / description / photo → admin OR perm_edit_info
//   add                          → admin OR perm_add_members
//   remove / promote             → admin ONLY
// so the UI hides what the current user cannot do rather than letting them tap
// into "Only a group admin can do that."
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, RADIUS, SPACING, themed } from '../theme';
import {
  Screen, ScreenHeader, Loader, EmptyState, Avatar, Sheet, Switch,
  InfoSection, InfoHero, MemberRow,
} from '../components/ui';
import * as chat from '../services/chat';
import { createLogger } from '../api/logger';

const log = createLogger('GroupManage');

// The six permission flags the server accepts, with wording that says what the
// switch DOES rather than repeating the field name.
const PERMS = [
  { key: 'perm_send', label: 'All members can send messages', off: 'Only admins can send' },
  { key: 'perm_edit_info', label: 'All members can edit group info', off: 'Only admins can edit' },
  { key: 'perm_add_members', label: 'All members can add others', off: 'Only admins can add' },
  { key: 'perm_send_history', label: 'New members see past messages', off: 'New members start fresh' },
  { key: 'perm_invite', label: 'All members can share the invite link', off: 'Only admins can invite' },
];

export default function GroupManageScreen({ conversation, onBack, onChanged }) {
  // Edge-to-edge draws under the nav bar; reserve that space at the bottom.
  const insets = useSafeAreaInsets();
  const convId = conversation?.id;
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [renameOpen, setRenameOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [contacts, setContacts] = useState([]);
  const [picked, setPicked] = useState([]);
  const [invite, setInvite] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const i = await chat.contactInfo(convId);
      setInfo(i);
      setName(i.name || '');
      setDesc(i.description || '');
    } catch (e) {
      log.warn('load failed', e?.message);
      setError(e?.message || 'Could not load the group.');
    }
  }, [convId]);

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false); })(); }, [load]);

  const run = async (fn, after) => {
    setBusy(true);
    try { await fn(); await load(); onChanged?.(); after?.(); }
    catch (e) { Alert.alert('Failed', e?.message || 'Please try again.'); }
    finally { setBusy(false); }
  };

  const canEditInfo = info?.isAdmin || info?.permissions?.perm_edit_info;
  const canAdd = info?.isAdmin || info?.permissions?.perm_add_members;
  const canInvite = info?.isAdmin || info?.permissions?.perm_invite;

  const openAdd = async () => {
    setAddOpen(true);
    setPicked([]);
    try {
      const all = await chat.fetchContacts('');
      const already = new Set((info?.members || []).map((m) => m.id));
      setContacts(all.filter((c) => !already.has(c.id)));
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Could not load contacts.');
    }
  };

  const shareInvite = async () => {
    try {
      const r = await chat.groupInvite(convId, 'get');
      const link = r.link || (await chat.groupInvite(convId, 'create')).link;
      if (!link) { Alert.alert('No link', 'The server did not return an invite link.'); return; }
      setInvite(link);
      await Share.share({ message: `Join "${info.name}" on 369Chats:\n${link}` });
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Could not get an invite link.');
    }
  };

  const memberMenu = (m) => {
    if (!info.isAdmin || m.id === info.meId) return;
    Alert.alert(m.name, undefined, [
      {
        text: m.isAdmin ? 'Dismiss as admin' : 'Make group admin',
        onPress: () => run(() => chat.updateGroup(convId, 'promote', { user_id: m.id })),
      },
      {
        text: 'Remove from group',
        style: 'destructive',
        onPress: () => run(() => chat.updateGroup(convId, 'remove', { user_id: m.id })),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (loading) return <Screen><Loader /></Screen>;
  if (error || !info) {
    return (
      <Screen>
        <ScreenHeader title="Group" onBack={onBack} />
        <EmptyState icon="alert-circle-outline" tone="error" title={error || 'Not found'} onRetry={load} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Manage group" onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <InfoHero
          name={info.name} uri={info.avatarUrl} size={92}
          title={info.name} sub={`${info.memberCount} members`}
        />

        <InfoSection>
          <Item
            icon="pencil-outline" label="Group name" value={info.name}
            onPress={canEditInfo ? () => setRenameOpen(true) : null}
          />
          <Item
            icon="document-text-outline" label="Description"
            value={info.description || 'No description'}
            onPress={canEditInfo ? () => setRenameOpen(true) : null}
            last={!canInvite}
          />
          {canInvite && (
            <Item icon="link-outline" label="Invite via link" value={invite || 'Tap to share'} onPress={shareInvite} last />
          )}
        </InfoSection>

        {info.isAdmin && (
          <>
            <InfoSection title="Permissions">
              {PERMS.map((p, i) => {
                const on = !!info.permissions?.[p.key];
                return (
                  <View key={p.key} style={[s.permRow, i === PERMS.length - 1 && s.permRowLast]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.permLabel}>{p.label}</Text>
                      {!on && <Text style={s.permOff}>{p.off}</Text>}
                    </View>
                    <Switch
                      value={on}
                      disabled={busy}
                      // Must send a real boolean: the server does bool(value) and
                      // the string "false" would read as true.
                      onValueChange={(v) => run(() => chat.groupPermissions(convId, p.key, v))}
                    />
                  </View>
                );
              })}
            </InfoSection>
          </>
        )}

        <InfoSection
          title={`${info.members?.length || 0} members`}
          right={canAdd ? (
            <TouchableOpacity style={s.addBtn} onPress={openAdd} activeOpacity={0.85}>
              <Ionicons name="person-add-outline" size={15} color={COLORS.primary} />
              <Text style={s.addTxt}>Add</Text>
            </TouchableOpacity>
          ) : null}
        >
          {(info.members || []).map((m, i) => (
            <MemberRow
              key={m.id}
              name={m.name} uri={m.avatarUrl} meta={m.mobile}
              you={m.id === info.meId} admin={m.isAdmin}
              // Only admins get a menu, so only they get a tappable row.
              onPress={info.isAdmin && m.id !== info.meId ? () => memberMenu(m) : null}
              right={info.isAdmin && m.id !== info.meId
                ? <Ionicons name="ellipsis-vertical" size={16} color={COLORS.faint} />
                : null}
              last={i === (info.members.length - 1)}
            />
          ))}
        </InfoSection>
      </ScrollView>

      {/* Rename + description */}
      <Sheet visible={renameOpen} onClose={() => setRenameOpen(false)} title="Group info">
        <Text style={s.fieldLabel}>Name</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Group name" placeholderTextColor={COLORS.faint} />
        <Text style={s.fieldLabel}>Description</Text>
        <TextInput
          style={[s.input, { height: 90, textAlignVertical: 'top', paddingTop: 12 }]}
          value={desc} onChangeText={setDesc} multiline
          placeholder="What is this group about?" placeholderTextColor={COLORS.faint}
        />
        <TouchableOpacity
          style={[s.primaryBtn, (!name.trim() || busy) && { backgroundColor: COLORS.slate400 }]}
          disabled={!name.trim() || busy}
          onPress={() => run(async () => {
            if (name.trim() !== info.name) await chat.updateGroup(convId, 'rename', { name: name.trim() });
            if (desc !== (info.description || '')) await chat.updateGroup(convId, 'description', { description: desc });
          }, () => setRenameOpen(false))}
        >
          <Text style={s.primaryTxt}>Save</Text>
        </TouchableOpacity>
      </Sheet>

      {/* Add members */}
      <Sheet visible={addOpen} onClose={() => setAddOpen(false)} title="Add members">
        <ScrollView style={{ maxHeight: 360 }}>
          {contacts.map((c) => {
            const on = picked.includes(c.id);
            return (
              <TouchableOpacity
                key={c.id} style={s.pickRow} activeOpacity={0.75}
                onPress={() => setPicked((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}
              >
                <Avatar name={c.name} uri={c.avatarUrl} size={38} />
                <Text style={s.pickName} numberOfLines={1}>{c.name}</Text>
                <View style={[s.check, on && s.checkOn]}>
                  {on && <Ionicons name="checkmark" size={14} color={COLORS.onPrimary} />}
                </View>
              </TouchableOpacity>
            );
          })}
          {!contacts.length && <Text style={s.emptyTxt}>Everyone you can reach is already in this group.</Text>}
        </ScrollView>
        <TouchableOpacity
          style={[s.primaryBtn, (!picked.length || busy) && { backgroundColor: COLORS.slate400 }]}
          disabled={!picked.length || busy}
          onPress={() => run(() => chat.updateGroup(convId, 'add', { member_ids: picked }), () => setAddOpen(false))}
        >
          <Text style={s.primaryTxt}>Add {picked.length || ''}</Text>
        </TouchableOpacity>
      </Sheet>
    </Screen>
  );
}

// Label-above-value, unlike the shared InfoRow's label-with-sub: these rows are
// editable fields, so the current value is the thing to read.
function Item({ icon, label, value, onPress, last }) {
  return (
    <TouchableOpacity
      style={[s.item, last && s.itemLast]}
      onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}
    >
      <Ionicons name={icon} size={20} color={COLORS.primary} />
      <View style={{ flex: 1 }}>
        <Text style={s.itemLabel}>{label}</Text>
        <Text style={s.itemValue} numberOfLines={2}>{value}</Text>
      </View>
      {!!onPress && <Ionicons name="chevron-forward" size={17} color={COLORS.faint} />}
    </TouchableOpacity>
  );
}

const s = themed((C) => ({
  item: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.screen,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.screen,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  itemLast: { borderBottomWidth: 0 },
  itemLabel: { fontSize: 12, color: C.slate500, fontWeight: '700' },
  itemValue: { fontSize: 14.5, color: C.ink, fontWeight: '600', marginTop: 2 },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.tintBg, borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 6,
  },
  addTxt: { fontSize: 12.5, fontWeight: '800', color: C.primary },

  permRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  permRowLast: { borderBottomWidth: 0 },
  permLabel: { fontSize: 14, color: C.ink, fontWeight: '600' },
  permOff: { fontSize: 11.5, color: C.slate500, marginTop: 2 },

  fieldLabel: { fontSize: 12.5, fontWeight: '800', color: C.muted, marginTop: SPACING.md, marginBottom: SPACING.xs },
  input: {
    backgroundColor: C.slate50, borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.line,
    paddingHorizontal: SPACING.screen, height: 46, fontSize: 15, color: C.ink,
  },
  primaryBtn: {
    height: 50, borderRadius: RADIUS.lg, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: SPACING.screen, marginBottom: SPACING.sm,
  },
  primaryTxt: { color: COLORS.onPrimary, fontSize: 15.5, fontWeight: '800' },

  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  pickName: { flex: 1, fontSize: 15, fontWeight: '700', color: C.ink },
  check: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: C.primary, borderColor: C.primary },
  emptyTxt: { fontSize: 13.5, color: C.slate500, padding: SPACING.xl, textAlign: 'center' },
}));
