// KEYPAD — WhatsApp's dialpad, adapted to a product with no phone network.
//
// WhatsApp dials a NUMBER. There is no telephony here: a call is placed into a
// conversation over WebRTC, so a literal dialler would have nothing to dial. The
// digits therefore filter your CONTACTS by mobile number, and calling a match
// opens (or creates) the 1:1 with them and rings it.
//
// Matching ignores spaces, dashes and brackets on both sides, so a stored
// "+91 98765 43210" is found by typing 9876. Names are searchable too — the
// server's /chat/contacts already does a name-or-mobile query — but the digits
// are what the pad is for.
import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PopupModal, Avatar } from '../ui';
import * as chat from '../../services/chat';
import { COLORS, RADIUS, SPACING, themed } from '../../theme';
import { createLogger } from '../../api/logger';

const log = createLogger('DialPad');

const KEYS = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
];

const digitsOf = (s) => String(s || '').replace(/[^\d]/g, '');

export default function DialPad({ visible, onClose, onCall }) {
  const [digits, setDigits] = useState('');
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);

  // Contacts are fetched once per open, then filtered locally — the list is
  // small and per-keystroke round trips would lag the pad.
  useEffect(() => {
    if (!visible) { setDigits(''); return undefined; }
    let alive = true;
    setLoading(true);
    chat.fetchContacts('')
      .then((list) => { if (alive) setContacts(list || []); })
      .catch((e) => log.warn('contacts failed', e?.message))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [visible]);

  const matches = useMemo(() => {
    const q = digitsOf(digits);
    if (!q) return [];
    return contacts.filter((c) => digitsOf(c.mobile).includes(q)).slice(0, 6);
  }, [digits, contacts]);

  return (
    <PopupModal visible={visible} onClose={onClose} title="Keypad">
      <Text style={s.readout} numberOfLines={1}>{digits || ' '}</Text>

      {loading ? <ActivityIndicator size="small" color={COLORS.slate400} /> : (
        <ScrollView style={{ maxHeight: 190 }} showsVerticalScrollIndicator={false}>
          {!!digits && !matches.length && (
            <Text style={s.none}>No contact with that number.</Text>
          )}
          {matches.map((c) => (
            <View key={c.id} style={s.hit}>
              <Avatar name={c.name} uri={c.avatarUrl} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={s.hitName} numberOfLines={1}>{c.name}</Text>
                <Text style={s.hitNum} numberOfLines={1}>{c.mobile}</Text>
              </View>
              <TouchableOpacity
                onPress={() => onCall?.(c, false)}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              >
                <Ionicons name="call" size={20} color={COLORS.green} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onCall?.(c, true)}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              >
                <Ionicons name="videocam" size={21} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={s.pad}>
        {KEYS.map(([d, sub]) => (
          <TouchableOpacity
            key={d}
            style={s.key}
            activeOpacity={0.6}
            onPress={() => setDigits((t) => (t.length < 20 ? t + d : t))}
          >
            <Text style={s.keyDigit}>{d}</Text>
            {!!sub && <Text style={s.keySub}>{sub}</Text>}
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.actions}>
        <TouchableOpacity
          onPress={() => setDigits((t) => t.slice(0, -1))}
          onLongPress={() => setDigits('')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          disabled={!digits}
        >
          <Ionicons name="backspace-outline" size={24} color={digits ? COLORS.navy : COLORS.faint} />
        </TouchableOpacity>
      </View>
    </PopupModal>
  );
}

const s = themed((C) => StyleSheet.create({
  readout: {
    fontSize: 24, fontWeight: '700', color: C.ink, textAlign: 'center',
    letterSpacing: 1.5, paddingVertical: SPACING.sm, minHeight: 44,
  },
  none: { fontSize: 12.5, color: C.slate500, textAlign: 'center', paddingVertical: SPACING.md },
  hit: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    paddingVertical: 8, paddingHorizontal: SPACING.xs,
  },
  hitName: { fontSize: 14.5, fontWeight: '700', color: C.ink },
  hitNum: { fontSize: 12, color: C.slate500 },

  pad: {
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'center', paddingTop: SPACING.sm,
  },
  key: {
    width: '31%', aspectRatio: 1.9, margin: '1%',
    alignItems: 'center', justifyContent: 'center',
    borderRadius: RADIUS.lg, backgroundColor: C.shellAlt,
  },
  keyDigit: { fontSize: 21, fontWeight: '700', color: C.ink },
  keySub: { fontSize: 9, fontWeight: '700', color: C.slate500, letterSpacing: 1 },

  actions: { alignItems: 'center', paddingTop: SPACING.md },
}));
