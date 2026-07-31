// Debug log viewer — the in-app replacement for `adb logcat`.
//
// Release builds are silent by default (api/logger.js), which is correct but left
// the device undiagnosable without a USB cable. This shows the ring buffer that
// logger.js fills, and lets it be shared out, so a fault on a real device can be
// investigated with no PC involved.
//
// Everything here is already redacted: logger.js runs redact() on the way INTO
// the buffer precisely because this screen can share it off the device.
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Screen, ScreenHeader, Switch, EmptyState } from '../components/ui';
import {
  isLoggingEnabled, setLoggingEnabled, getLogBuffer, clearLogBuffer,
  onLogChange, formatLogBuffer,
} from '../api/logger';
import { COLORS, RADIUS, SPACING, TOP, themed } from '../theme';

const LEVEL_COLOR = { warn: 'amber', error: 'red' };

export default function DebugLogScreen({ onBack }) {
  const [on, setOn] = useState(isLoggingEnabled());
  const [entries, setEntries] = useState(() => getLogBuffer());
  const [shared, setShared] = useState(null);

  // Re-read on every write. The buffer is capped at 500 entries, so copying it is
  // cheap and this stays simpler than diffing.
  useEffect(() => onLogChange(() => setEntries(getLogBuffer())), []);

  const toggle = useCallback(async (next) => {
    setOn(next);
    await setLoggingEnabled(next);
    setEntries(getLogBuffer());
  }, []);

  // Share as a FILE rather than a string: logs run to tens of KB and most share
  // targets truncate or mangle long plain text.
  const share = useCallback(async () => {
    try {
      const body = formatLogBuffer();
      const dir = FileSystem.cacheDirectory;
      if (!dir || !(await Sharing.isAvailableAsync())) { setShared('Sharing is unavailable on this device.'); return; }
      const path = `${dir}369chats-log.txt`;
      await FileSystem.writeAsStringAsync(path, body);
      await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: 'Share debug log' });
      setShared(null);
    } catch (e) {
      setShared(e?.message || 'Could not share the log.');
    }
  }, []);

  return (
    <Screen>
      <ScreenHeader
        title="Debug log"
        onBack={onBack}
        top={TOP}
        right={
          <TouchableOpacity onPress={share} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="share-outline" size={22} color={COLORS.primary} />
          </TouchableOpacity>
        }
      />

      <View style={s.bar}>
        <View style={{ flex: 1 }}>
          <Text style={s.barTitle}>Capture logs</Text>
          <Text style={s.barSub}>
            Off by default. Turn on, reproduce the problem, then share this log.
          </Text>
        </View>
        <Switch value={on} onValueChange={toggle} />
      </View>

      <View style={s.actions}>
        <Text style={s.count}>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</Text>
        <TouchableOpacity onPress={() => { clearLogBuffer(); setEntries([]); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={s.clear}>Clear</Text>
        </TouchableOpacity>
      </View>

      {!!shared && <Text style={s.err}>{shared}</Text>}

      {entries.length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          title={on ? 'Nothing captured yet' : 'Logging is off'}
          sub={on
            ? 'Reproduce the problem and entries will appear here.'
            : 'Turn on Capture logs above, then reproduce the problem.'}
        />
      ) : (
        <ScrollView style={s.list} contentContainerStyle={s.listInner}>
          {entries.map((e, i) => (
            <View key={`${e.t}-${i}`} style={s.row}>
              <Text style={s.time}>{e.t}</Text>
              <Text style={[s.msg, e.level === 'error' && s.msgErr, e.level === 'warn' && s.msgWarn]}>
                <Text style={s.tag}>[{e.tag}] </Text>{e.msg}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const s = themed((C) => ({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    marginHorizontal: SPACING.screen, marginTop: SPACING.sm,
    padding: SPACING.screen,
    backgroundColor: C.card, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: C.line,
  },
  barTitle: { fontSize: 15, fontWeight: '800', color: C.ink },
  barSub: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 16 },

  actions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
  },
  count: { fontSize: 12.5, color: C.muted, fontWeight: '700' },
  clear: { fontSize: 13, color: C.red, fontWeight: '800' },

  err: {
    marginHorizontal: SPACING.screen, marginBottom: SPACING.sm,
    fontSize: 12.5, color: C.red,
  },

  list: { flex: 1 },
  listInner: { paddingHorizontal: SPACING.screen, paddingBottom: SPACING.xl },
  row: {
    flexDirection: 'row', gap: SPACING.sm,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  time: { fontSize: 10.5, color: C.slate500, fontVariant: ['tabular-nums'], width: 74 },
  tag: { fontWeight: '800', color: C.primary },
  msg: { flex: 1, fontSize: 11.5, color: C.ink, lineHeight: 16 },
  msgWarn: { color: C.amber },
  msgErr: { color: C.red },
}));
