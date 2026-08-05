// Flat "mobile login" illustration (SVG) for the sign-in screen: a person beside
// a phone showing the verification code they are about to type, with a chat
// bubble tying it to what the app is actually for.
//
// DRAWN, NOT DOWNLOADED. Storyset was the reference for the style, and its free
// tier requires the credit "Illustration by Storyset" to be shown wherever the
// art appears — a permanent line on the product's sign-in screen, in exchange
// for a scene that is a few dozen paths. Vector also means no asset to ship, no
// density variants, and crisp at any size.
//
// DELIBERATELY FACELESS. A face at this size is three dots that age badly, and
// drawing one turns a decoration into a decision about whose face it is.
//
// KEPT NEAT BY RATIONING THE PALETTE. Three colours plus a pale tint, and only
// FOUR opacity steps (0.08 / 0.15 / 0.25 / 0.55) rather than a value picked
// afresh each time something needed to recede. Ad-hoc opacities are what make a
// small illustration read as noise: at a third of the screen width the eye
// cannot tell 0.12 from 0.13, it only registers that nothing sits on a shared
// plane.
//
// Stroke weights are structural, not decorative: 3 outlines the phone, 2.4 the
// bubble, 7–8 are limbs, and 1.6/3.4 are details inside the screen.
//
// No gradients — they band visibly on cheap Android panels at this size.
import React from 'react';
import Svg, { Circle, Ellipse, Rect, Path, G } from 'react-native-svg';

const NAVY = '#1F3B57';   // outlines and the figure
const BLUE = '#2E6FE0';   // the one accent
const TINT = '#DCE7F5';   // pale fill
const WHITE = '#FFFFFF';

// The viewBox is unchanged (300×220) so AppLoginScreen's existing sizing and
// heroWrap layout keep working without being touched.
export default function LoginArt({ width = 240, height = 176 }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 300 220" fill="none">
      {/* Backdrop — the same soft-blob language as the splash and the form wave,
          so the screen reads as one thing rather than an illustration pasted on
          top of a form. */}
      <Circle cx="150" cy="106" r="92" fill={BLUE} opacity="0.08" />
      <Circle cx="248" cy="42" r="9" fill={BLUE} opacity="0.25" />
      <Circle cx="44" cy="60" r="6" fill={NAVY} opacity="0.25" />
      <Circle cx="52" cy="170" r="12" fill={BLUE} opacity="0.15" />

      {/* Ground shadow, so the scene sits rather than floats. */}
      <Ellipse cx="152" cy="196" rx="80" ry="9" fill={NAVY} opacity="0.08" />

      {/* ── The phone. Tilted ~6°, because a phone stood perfectly upright reads
             as a product shot; a tilted one reads as being held. ── */}
      <G transform="rotate(-6 168 110)">
        <Rect x="132" y="34" width="72" height="150" rx="15"
              fill={WHITE} stroke={NAVY} strokeWidth="3" />
        <Rect x="141" y="50" width="54" height="112" rx="7" fill={TINT} />
        {/* earpiece */}
        <Rect x="157" y="41" width="22" height="4" rx="2" fill={NAVY} opacity="0.25" />

        {/* The code screen — what the user is one step away from seeing. Four
            boxes filled and two waiting, so it reads as mid-entry. */}
        <Rect x="149" y="72" width="13" height="17" rx="3" fill={BLUE} />
        <Rect x="165" y="72" width="13" height="17" rx="3" fill={BLUE} />
        <Rect x="181" y="72" width="13" height="17" rx="3" fill={WHITE} stroke={BLUE} strokeWidth="1.6" />

        {/* A tick under it: the code was accepted. */}
        <Circle cx="168" cy="118" r="17" fill={BLUE} />
        <Path d="M160 118 l6 6 l12 -13" stroke={WHITE} strokeWidth="3.4"
              fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {/* Two short lines standing in for the rest of the screen. */}
        <Rect x="150" y="146" width="36" height="4" rx="2" fill={NAVY} opacity="0.25" />
        <Rect x="150" y="155" width="24" height="4" rx="2" fill={NAVY} opacity="0.15" />
      </G>

      {/* ── The person, reduced to simple shapes. Standing to the left, turned
             toward the phone. ── */}
      <G>
        {/* legs */}
        <Path d="M74 190 v-34" stroke={NAVY} strokeWidth="7" strokeLinecap="round" />
        <Path d="M92 190 v-34" stroke={NAVY} strokeWidth="7" strokeLinecap="round" />
        {/* body */}
        <Path d="M83 96 c-16 0 -22 12 -22 26 v38 h44 v-38 c0 -14 -6 -26 -22 -26 z" fill={BLUE} />
        {/* the arm reaching toward the phone */}
        <Path d="M103 124 c16 -4 22 -12 26 -22" stroke={BLUE} strokeWidth="8"
              fill="none" strokeLinecap="round" />
        {/* head */}
        <Circle cx="83" cy="80" r="17" fill={NAVY} />
        {/* hair, as one shape — enough to read as a person, no features */}
        <Path d="M66 76 a17 17 0 0 1 34 0 c-6 -5 -12 -7 -17 -7 s-11 2 -17 7 z" fill={BLUE} opacity="0.55" />
      </G>

      {/* ── A chat bubble, so the scene is about THIS app and not any login. ── */}
      <G>
        <Path d="M212 58 h44 a9 9 0 0 1 9 9 v22 a9 9 0 0 1 -9 9 h-26 l-12 10 v-10 h-6
                 a9 9 0 0 1 -9 -9 v-22 a9 9 0 0 1 9 -9 z"
              fill={WHITE} stroke={NAVY} strokeWidth="2.4" strokeLinejoin="round" />
        <Rect x="221" y="70" width="26" height="4" rx="2" fill={BLUE} />
        <Rect x="221" y="80" width="18" height="4" rx="2" fill={NAVY} opacity="0.25" />
      </G>
    </Svg>
  );
}
