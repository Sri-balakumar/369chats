// SelectField — a tappable field that looks like a text input but opens a picker.
// Shows `value`, or `placeholder` in the faint colour when empty.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../../theme';

export default function SelectField({ label, value, placeholder, onPress, required, style }) {
  return (
    <View style={style}>
      {!!label && (
        <Text style={s.label}>
          {label}{required ? <Text style={s.req}> *</Text> : null}
        </Text>
      )}
      <TouchableOpacity style={s.field} onPress={onPress} activeOpacity={0.8}>
        <Text style={[s.txt, { color: value ? COLORS.ink : COLORS.faint }]} numberOfLines={1}>
          {value || placeholder || 'Select'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={COLORS.muted} />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', color: COLORS.muted, marginTop: SPACING.lg, marginBottom: SPACING.xs },
  req: { color: COLORS.red, fontWeight: '900' },
  field: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F5F8FD', borderWidth: 1.5, borderColor: '#E7ECF3',
    borderRadius: RADIUS.lg, paddingHorizontal: SPACING.screen, height: 50,
  },
  txt: { flex: 1, fontSize: 15, marginRight: SPACING.sm },
});
