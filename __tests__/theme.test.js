// Theme contract tests.
//
// The mechanism in theme.js is easy to break silently: a live proxy that resolves
// COLORS against whatever accent is active, and themed() sheets that are built
// once PER ACCENT and handed out by another proxy. If either stops following the
// active accent, screens render in the wrong brand colour and no other test
// notices — every screen still mounts fine.
//
// The app is LIGHT ONLY. There is no dark mode on either client, by design.
import { StyleSheet, Text } from 'react-native';
import React from 'react';
import { render, act } from '@testing-library/react-native';
import {
  COLORS, SHADOW, themed, ThemeProvider, useTheme,
  THEME_VARIANTS, DEFAULT_VARIANT, activeThemeKey,
} from '../theme';

let pickAccent;
function Probe() {
  const { setVariant, key, ready } = useTheme();
  pickAccent = setVariant;
  // The provider restores the saved accent from AsyncStorage in an effect, so a
  // change made before that resolves gets overwritten. Tests wait for 'ready'.
  return (
    <>
      <Text>{key}</Text>
      <Text>{ready ? 'ready' : 'loading'}</Text>
    </>
  );
}

describe('theme', () => {
  afterEach(() => { if (pickAccent) act(() => pickAccent(DEFAULT_VARIANT)); });

  it("defaults to the web module's default accent", () => {
    // chat_app.js: localStorage.getItem('o369_theme') || 'clean'
    expect(DEFAULT_VARIANT).toBe('clean');
    expect(activeThemeKey()).toBe('clean');
    expect(COLORS.card).toBe('#FFFFFF');
  });

  it('offers the same seven accents as the web client, in the same order', () => {
    expect(THEME_VARIANTS.map((v) => v.id))
      .toEqual(['clean', 'ocean', 'emerald', 'sunset', 'violet', 'graphite', 'rose']);
  });

  it('every accent produces a complete palette', async () => {
    // An accent that forgets a key would render transparent on that accent only —
    // the kind of thing that shows up on one user's phone and nowhere else.
    const { findByText } = render(<ThemeProvider><Probe /></ThemeProvider>);
    await findByText('ready');
    const expected = Object.keys({ ...COLORS }).sort();

    for (const v of THEME_VARIANTS) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { pickAccent(v.id); });
      const got = { ...COLORS };
      expect(Object.keys(got).sort()).toEqual(expected);
      for (const k of expected) {
        expect(typeof got[k]).toBe('string');
        expect(got[k].length).toBeGreaterThan(0);
      }
    }
  }, 30000);

  it('accent changes the brand but not the surfaces', async () => {
    const { findByText } = render(<ThemeProvider><Probe /></ThemeProvider>);
    await findByText('ready');
    const cardBefore = COLORS.card;

    await act(async () => { pickAccent('rose'); });
    await findByText('rose');

    // .o369-theme-rose overrides brand/accent only; panel is untouched.
    expect(COLORS.primary).toBe('#BE185D');
    expect(COLORS.accent).toBe('#FB7185');
    expect(COLORS.card).toBe(cardBefore);
  });

  it("matches the web module's brand tokens", async () => {
    const { findByText } = render(<ThemeProvider><Probe /></ThemeProvider>);
    await findByText('ready');
    await act(async () => { pickAccent('ocean'); });
    await findByText('ocean');

    // chat_app.scss `.o369-theme-ocean` + the shared --o369-ownbg / --o369-panel.
    expect(COLORS.primary).toBe('#1F5F9E');
    expect(COLORS.accent).toBe('#F47A20');
    expect(COLORS.bubbleMine).toBe('#E7F0FA');
    expect(COLORS.card).toBe('#FFFFFF');
  });

  it('themed() sheets resolve to the active accent', async () => {
    const s = themed((C) => ({ box: { backgroundColor: C.card, borderColor: C.primary } }));
    const { findByText } = render(<ThemeProvider><Probe /></ThemeProvider>);
    await findByText('ready');
    expect(StyleSheet.flatten(s.box).borderColor).toBe('#2563A8');   // clean

    await act(async () => { pickAccent('emerald'); });
    expect(StyleSheet.flatten(s.box).borderColor).toBe('#0E8F53');
    // Surfaces are shared, so the card colour must NOT have moved.
    expect(StyleSheet.flatten(s.box).backgroundColor).toBe('#FFFFFF');
  });

  it('SHADOW is spreadable', () => {
    // Several StyleSheet blocks do `...SHADOW`.
    const spread = { ...SHADOW };
    expect(spread.shadowRadius).toBeGreaterThan(0);
    expect(spread.elevation).toBeDefined();
  });
});
