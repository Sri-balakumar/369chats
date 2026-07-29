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
import { COLORS, SHADOW, RADIUS, SPACING, TOP, themed } from '../theme';
import { Screen, Loader, EmptyState, Avatar, Sheet, Switch } from '../components/ui';
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
        <Header onBack={onBack} title="Group" />
        <EmptyState icon="alert-circle-outline" tone="error" title={error || 'Not found'} onRetry={load} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Header onBack={onBack} title="Manage group" />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <Avatar name={info.name} uri={info.avatarUrl} size={92} />
          <Text style={s.title} numberOfLines={2}>{info.name}</Text>
          <Text style={s.sub}>{info.memberCount} members</Text>
        </View>

        <View style={s.card}>
          <Item
            icon="pencil-outline" label="Group name" value={info.name}
            onPress={canEditInfo ? () => setRenameOpen(true) : null}
          />
          <Item
            icon="document-text-outline" label="Description"
            value={info.description || 'No description'}
            onPress={canEditInfo ? () => setRenameOpen(true) : null}
          />
          {canInvite && <Item icon="link-outline" label="Invite via link" value={invite || 'Tap to share'} onPress={shareInvite} />}
        </View>

        {info.isAdmin && (
          <>
            <Text style={s.section}>Permissions</Text>
            <View style={s.card}>
              {PERMS.map((p) => {
                const on = !!info.permissions?.[p.key];
                return (
                  <View key={p.key} style={s.permRow}>
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
            </View>
          </>
        )}

        <View style={s.sectionRow}>
          <Text style={[s.section, { paddingHorizontal: 0 }]}>{info.members?.length || 0} members</Text>
          {canAdd && (
            <TouchableOpacity style={s.addBtn} onPress={openAdd} activeOpacity={0.85}>
              <Ionicons name="person-add-outline" size={15} color={COLORS.primary} />
              <Text style={s.addTxt}>Add</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={s.card}>
          {(info.members || []).map((m) => (
            <TouchableOpacity
              key={m.id} style={s.member} activeOpacity={info.isAdmin ? 0.7 : 1}
              onPress={() => memberMenu(m)}
            >
              <Avatar name={m.name} uri={m.avatarUrl} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={s.memberName} numberOfLines={1}>
                  {m.name}{m.id === info.meId ? ' (You)' : ''}
                </Text>
                {!!m.mobile && <Text style={s.memberMeta}>{m.mobile}</Text>}
              </View>
              {m.isAdmin && <View style={s.pill}><Text style={s.pillTxt}>Admin</Text></View>}
              {info.isAdmin && m.id !== info.meId && (
                <Ionicons name="ellipsis-vertical" size={16} color={COLORS.faint} />
              )}
            </TouchableOpacity>
          ))}
        </View>
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

function Header({ onBack, title }) {
  return (
    <View style={[s.header, { paddingTop: TOP }]}>
      <TouchableOpacity onPress={onBack} style={s.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Ionicons name="chevron-back" size={24} color={COLORS.navy} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

function Item({ icon, label, value, onPress }) {
  return (
    <TouchableOpacity style={s.item} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}>
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
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: SPACING.md,
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '900', color: C.navy },
  iconBtn: {
    width: 40, height: 40, borderRadius: RADIUS.lg, backgroundColor: COLORS.card,
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },

  hero: { alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.xs },
  title: { fontSize: 20, fontWeight: '900', color: C.navy, textAlign: 'center', paddingHorizontal: 30 },
  sub: { fontSize: 13.5, color: C.slate500, fontWeight: '600' },

  card: {
    marginHorizontal: SPACING.screen, marginBottom: SPACING.screen,
    backgroundColor: COLORS.card, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: C.line,
    overflow: 'hidden', ...SHADOW,
  },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.screen,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.screen,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  itemLabel: { fontSize: 12, color: C.slate500, fontWeight: '700' },
  itemValue: { fontSize: 14.5, color: C.ink, fontWeight: '600', marginTop: 2 },

  section: {
    fontSize: 12.5, fontWeight: '900', color: C.muted, letterSpacing: 0.8,
    paddingHorizontal: SPACING.xl, marginBottom: SPACING.sm, textTransform: 'uppercase',
  },
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl, marginBottom: SPACING.sm,
  },
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
  permLabel: { fontSize: 14, color: C.ink, fontWeight: '600' },
  permOff: { fontSize: 11.5, color: C.slate500, marginTop: 2 },

  member: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  memberName: { fontSize: 14.5, fontWeight: '700', color: C.ink },
  memberMeta: { fontSize: 12, color: C.slate500, marginTop: 1 },
  pill: { backgroundColor: COLORS.slate50, borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 3 },
  pillTxt: { fontSize: 10.5, fontWeight: '900', color: C.primary },

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
