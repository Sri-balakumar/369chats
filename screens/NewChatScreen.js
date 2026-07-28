// NEW CHAT — pick someone to message, or select several and make a group.
//
// The contact roster is decided entirely server-side: /chat/contacts returns
// internal, active users who have BOTH a mobile number and app-login enabled. So
// an empty list here usually means those fields aren't set on the Odoo users, not
// that the request failed — the empty state says so rather than blaming the network.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SHADOW, RADIUS, SPACING, TOP } from '../theme';
import { Screen, Loader, EmptyState, Avatar, emptyWrap } from '../components/ui';
import * as chat from '../services/chat';
import { createLogger } from '../api/logger';

const log = createLogger('NewChat');

export default function NewChatScreen({ onBack, onOpenChat }) {
  const insets = useSafeAreaInsets();   // the FAB and the list must clear the nav bar
  const [contacts, setContacts] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Group mode: selecting more than one person turns this into a group builder.
  const [groupMode, setGroupMode] = useState(false);
  const [selected, setSelected] = useState([]);   // user ids
  const [groupName, setGroupName] = useState('');

  const debounce = useRef(null);

  const load = useCallback(async (q) => {
    setError(null);
    try {
      setContacts(await chat.fetchContacts(q || ''));
    } catch (e) {
      log.warn('contacts failed', e?.message);
      setError(e?.message || 'Could not load contacts.');
    }
  }, []);

  useEffect(() => { (async () => { setLoading(true); await load(''); setLoading(false); })(); }, [load]);

  // Search server-side (it matches mobile numbers too, which a local filter can't
  // do because the list is already trimmed).
  const onQuery = (t) => {
    setQuery(t);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(t), 300);
  };

  const toggle = (id) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const openDirect = async (userId) => {
    setBusy(true);
    try {
      const conv = await chat.openDirect(userId);
      onOpenChat(conv);
    } catch (e) {
      Alert.alert('Could not open chat', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const makeGroup = async () => {
    const name = groupName.trim();
    if (!name) { Alert.alert('Group name', 'Give the group a name first.'); return; }
    if (!selected.length) { Alert.alert('Members', 'Pick at least one person.'); return; }
    setBusy(true);
    try {
      const conv = await chat.createGroup(name, selected);
      onOpenChat(conv);
    } catch (e) {
      Alert.alert('Could not create group', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const renderContact = ({ item }) => {
    const on = selected.includes(item.id);
    return (
      <TouchableOpacity
        style={s.row}
        activeOpacity={0.75}
        onPress={() => (groupMode ? toggle(item.id) : openDirect(item.id))}
        onLongPress={() => { if (!groupMode) { setGroupMode(true); toggle(item.id); } }}
        disabled={busy}
      >
        <Avatar name={item.name} uri={item.avatarUrl} size={46} />
        <View style={s.rowBody}>
          <Text style={s.name} numberOfLines={1}>{item.name}</Text>
          <Text style={s.meta} numberOfLines={1}>{item.mobile || item.role}</Text>
        </View>
        {groupMode && (
          <View style={[s.check, on && s.checkOn]}>
            {on && <Ionicons name="checkmark" size={15} color="#fff" />}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Screen>
      <View style={[s.header, { paddingTop: TOP }]}>
        <TouchableOpacity
          onPress={() => (groupMode ? (setGroupMode(false), setSelected([])) : onBack())}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={s.iconBtn}
        >
          <Ionicons name="chevron-back" size={24} color={COLORS.navy} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>
          {groupMode ? `New group · ${selected.length} selected` : 'New chat'}
        </Text>
        <TouchableOpacity
          onPress={() => { setGroupMode((g) => !g); setSelected([]); }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={s.iconBtn}
        >
          <Ionicons name={groupMode ? 'person-outline' : 'people-outline'} size={21} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {groupMode && (
        <View style={s.groupNameWrap}>
          <Ionicons name="pricetag-outline" size={17} color={COLORS.faint} />
          <TextInput
            style={s.search} value={groupName} onChangeText={setGroupName}
            placeholder="Group name" placeholderTextColor={COLORS.faint}
          />
        </View>
      )}

      <View style={s.searchWrap}>
        <Ionicons name="search" size={17} color={COLORS.faint} />
        <TextInput
          style={s.search} value={query} onChangeText={onQuery}
          placeholder="Search name or number" placeholderTextColor={COLORS.faint}
          autoCapitalize="none"
        />
        {!!query && (
          <TouchableOpacity onPress={() => { setQuery(''); load(''); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close-circle" size={17} color={COLORS.faint} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <Loader />
      ) : error ? (
        <View style={emptyWrap}>
          <EmptyState icon="alert-circle-outline" tone="error" title={error} onRetry={() => load(query)} />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={contacts}
          keyExtractor={(c) => String(c.id)}
          renderItem={renderContact}
          contentContainerStyle={contacts.length ? { paddingBottom: 90 + insets.bottom } : emptyWrap}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={query ? 'No matches' : 'No contacts available'}
              sub={query
                ? 'Try a different name or number.'
                : 'Contacts are Odoo users with a mobile number and app login enabled.'}
            />
          }
        />
      )}

      {groupMode && (
        <TouchableOpacity style={[s.fab, { bottom: 24 + insets.bottom }]} onPress={makeGroup} activeOpacity={0.9} disabled={busy}>
          {busy
            ? <ActivityIndicator color="#fff" />
            : <><Ionicons name="checkmark" size={20} color="#fff" /><Text style={s.fabTxt}>Create group</Text></>}
        </TouchableOpacity>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: 16, paddingBottom: SPACING.md,
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '900', color: COLORS.navy },
  iconBtn: {
    width: 40, height: 40, borderRadius: RADIUS.lg, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginHorizontal: SPACING.screen, marginBottom: SPACING.md,
    backgroundColor: '#fff', borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.line,
    paddingHorizontal: SPACING.lg, height: 42,
  },
  groupNameWrap: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginHorizontal: SPACING.screen, marginBottom: SPACING.md,
    backgroundColor: '#fff', borderRadius: RADIUS.lg, borderWidth: 1.5, borderColor: COLORS.primary,
    paddingHorizontal: SPACING.lg, height: 46,
  },
  search: { flex: 1, fontSize: 14.5, color: COLORS.ink, paddingVertical: 0 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
  },
  rowBody: { flex: 1 },
  name: { fontSize: 15.5, fontWeight: '800', color: COLORS.slate900 },
  meta: { fontSize: 12.5, color: COLORS.slate500, marginTop: 2 },
  check: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: COLORS.line,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },

  fab: {
    position: 'absolute', left: SPACING.screen, right: SPACING.screen, bottom: 24,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    height: 52, borderRadius: RADIUS.lg, backgroundColor: COLORS.primary, ...SHADOW,
  },
  fabTxt: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
});
