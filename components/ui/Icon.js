// Icon — picks between the two icon sets the app uses from a `lib` tag, so tile
// and menu tables can stay plain data ({ lib: 'mc', name: 'cog' }).
import React from 'react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

export default function Icon({ lib, name, size = 22, color }) {
  return lib === 'mc'
    ? <MaterialCommunityIcons name={name} size={size} color={color} />
    : <Ionicons name={name} size={size} color={color} />;
}
