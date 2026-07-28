// Avatar — a circular photo that falls back to initials on a colour derived from
// the name, so two different people are rarely the same colour and the same
// person is always the same colour (the hash is stable, not random).
//
// `uri` null/failed → initials. Deliberately handles onError: a broken avatar URL
// (expired session, deleted attachment) must not leave a blank circle.
import React, { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { COLORS } from '../../theme';

// Muted, readable-on-white fills. Kept deliberately few so a group of avatars
// still looks like one palette.
const FILLS = [
  '#2563EB', '#7C3AED', '#DB2777', '#0891B2',
  '#16A34A', '#D97706', '#4338CA', '#0369A1',
];

export function colorForName(name) {
  const s = String(name || '?');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return FILLS[h % FILLS.length];
}

export function initialsFor(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export default function Avatar({ name, uri, size = 46, style, online }) {
  const [failed, setFailed] = useState(false);
  // A new uri deserves a fresh attempt — otherwise one failure sticks forever.
  useEffect(() => { setFailed(false); }, [uri]);

  const box = { width: size, height: size, borderRadius: size / 2 };
  const showImage = !!uri && !failed;

  return (
    <View style={[box, s.wrap, style]}>
      {showImage ? (
        <Image
          source={{ uri }}
          style={[box, s.img]}
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={[box, s.fallback, { backgroundColor: colorForName(name) }]}>
          <Text style={[s.initials, { fontSize: size * 0.38 }]} numberOfLines={1}>
            {initialsFor(name)}
          </Text>
        </View>
      )}
      {online != null && (
        <View
          style={[
            s.dot,
            {
              width: size * 0.26, height: size * 0.26, borderRadius: size * 0.13,
              backgroundColor: online ? COLORS.green : COLORS.slate400,
            },
          ]}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  img: { backgroundColor: COLORS.slate100 },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#fff', fontWeight: '800' },
  dot: { position: 'absolute', right: 0, bottom: 0, borderWidth: 2, borderColor: '#fff' },
});
