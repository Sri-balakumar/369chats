// EmptyState — icon + bold title + faint subtitle, centred. Also covers the error
// case: pass `onRetry` to get the retry button, and a red `tone` for failures.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../../theme';

export default function EmptyState({ icon = 'file-tray-outline', title, sub, onRetry, tone = 'muted' }) {
  const iconColor = tone === 'error' ? '#EF4444' : COLORS.slate400;
  return (
    <View style={s.wrap}>
      <Ionicons name={icon} size={44} color={iconColor} />
      {!!title && <Text style={[s.title, tone === 'error' && { color: '#EF4444' }]}>{title}</Text>}
      {!!sub && <Text style={s.sub}>{sub}</Text>}
      {!!onRetry && (
        <TouchableOpacity onPress={onRetry} style={s.retry} activeOpacity={0.85}>
          <Text style={s.retryTxt}>Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// contentContainerStyle for a FlatList that is currently empty — makes the empty
// state fill and centre in the remaining space instead of hugging the top.
export const emptyWrap = { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 30 };

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, padding: 30 },
  title: { fontSize: 16, fontWeight: '800', color: COLORS.muted, textAlign: 'center' },
  sub: { fontSize: 12.5, color: COLORS.faint, textAlign: 'center' },
  retry: {
    marginTop: SPACING.xs, backgroundColor: COLORS.primary,
    paddingHorizontal: 22, height: 44, borderRadius: RADIUS.lg, justifyContent: 'center',
  },
  retryTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
