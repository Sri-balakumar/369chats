// Switch — React Native's Switch with theme-aware colours.
//
// The bare RN Switch hardcodes a near-white track (#e9e9ea) and a white thumb,
// which on a dark surface reads as a bright blob rather than a control. It has
// no styleable surface either — the colours only come from these four props, so
// wrapping it once is the only way to get them right everywhere.
import React from 'react';
import { Switch as RNSwitch } from 'react-native';
import { COLORS } from '../../theme';

export default function Switch({ value, onValueChange, disabled, ...rest }) {
  const off = COLORS.line;
  // The thumb sits on a filled track, so it wants the same treatment as text on
  // a coloured button.
  const thumb = COLORS.onOverlay;

  return (
    <RNSwitch
      value={!!value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: off, true: COLORS.primary }}
      thumbColor={thumb}
      ios_backgroundColor={off}
      {...rest}
    />
  );
}
