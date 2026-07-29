// 369 ai.Biz / alphalize brand — the web module's palette, seven accents.
//
// WHY THIS FILE LOOKS LIKE THIS
//
// The app has ~860 `COLORS.*` references across 53 files, and almost all of them
// sit inside a module-level `StyleSheet.create({...})`. That block runs ONCE, at
// import time, and bakes whatever string COLORS held at that moment — so simply
// swapping the object at runtime changes nothing that is already on screen. A
// theme toggle therefore needs two different mechanisms, and this file provides
// both so that call sites barely change:
//
//   1. `COLORS` / `SHADOW` / `SCRIM` are live proxies. Every property read goes to
//      the ACTIVE palette, so the ~400 inline uses (icon `color=`, `placeholder-
//      TextColor=`, conditional styles) follow the theme with no edit at all.
//
//   2. `themed(C => ({...}))` replaces `StyleSheet.create({...})` for stylesheets.
//      It builds one real StyleSheet per palette, lazily, and hands back a proxy
//      that resolves to the active one. The body of the block is untouched — the
//      factory argument is named `C`, and inside it `C.card` reads exactly like
//      `COLORS.card` did.
//
// Because a component that never calls useTheme() would not re-render on an
// accent change, App.js keys the screen tree by the accent id; switching remounts
// the tree, which is cheap and correct for something the user does rarely.
//
// There is deliberately NO dark mode: the product is light-only on both clients.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const K_VARIANT = 'app_theme_accent'; // one of VARIANTS below

// ── palettes ────────────────────────────────────────────────────────────────
// Mirrors how the web module is built: a shared set of surface/text tokens, plus
// a variant that overrides only FIVE brand tokens — brand, brand-deep, accent,
// accent-deep and wall (the `.o369-theme-*` rules). Every key must exist in every
// result, or a missing one reads `undefined` and renders transparent.

const LIGHT = {
  // Values come from the WEB module's CSS custom properties
  // (odoo_modules/chats_369/static/src/chat_app/chat_app.scss, the `.o369` block)
  // so the two clients are the same product. Web token names are in comments.
  primary: '#1F5F9E',     // --o369-brand (steel blue, NOT the old royal #1E40AF)
  primaryDark: '#16406E', // --o369-brand-deep
  navy: '#141B24',        // --o369-text — headings are just text on web
  link: '#1F5F9E',        // --o369-brand
  ink: '#141B24',         // --o369-text
  muted: '#5A6675',       // --o369-text2
  faint: '#8A94A3',       // --o369-grey
  bg: '#F6F8FB',          // --o369-ground
  card: '#FFFFFF',        // --o369-panel
  line: '#E6EDF5',        // --o369-line
  field: '#F2F5F9',       // --o369-field
  wave: '#E7F0FA',
  waveDeep: '#D6E4F2',
  green: '#0E8F53', greenBg: '#E6F5EC',
  amber: '#F47A20', amberBg: '#FDEBDD',
  red: '#DC2626', redBg: '#FEECEC',

  // Web is a flat surface, so these two stops are a whisper apart — enough to
  // keep the app's depth without reintroducing a gradient the web doesn't have.
  bgTop: '#F6F8FB',        // --o369-ground
  bgBottom: '#EEF3F8',     // --o369-wall
  shell: '#F6F8FB',        // every screen's root backgroundColor
  shellAlt: '#EEF3F8',     // ScreenTransition + the App.js gate loader
  // Slate ramp, re-pointed at the web's text/surface ramp.
  slate900: '#141B24',
  slate700: '#3A4553',
  slate500: '#5A6675',
  slate400: '#8A94A3',
  slate100: '#F2F5F9',
  slate50: '#F6F8FB',
  greenLine: '#B7E2C9',
  redLine: '#F6C9C9',

  // The orange the app never had. On web it carries unread badges, the unread
  // dot, pin marks and the primary sheet button — the whole "something needs
  // you" language, which the app was doing in green.
  accent: '#F47A20',       // --o369-accent
  accentDeep: '#E85D1B',   // --o369-accent-deep
  wallpaper: '#F1F4F9',    // --o369-convbg, the conversation ground

  // ---- tokens added for theming ----
  // Absorbed from colours that were hardcoded in screens. Named by ROLE, not by
  // hue, so a variant can change the hue without renaming anything.
  onPrimary: '#FFFFFF',    // text/icon drawn ON a primary/accent-filled surface
  tintBg: '#EAF1FA',       // --o369-accent-soft (selected row, chips, pills)
  // Web's own bubble is pale BLUE, not WhatsApp green. This is the single most
  // visible difference between the two clients.
  bubbleMine: '#E7F0FA',   // --o369-ownbg
  bubbleTheirs: '#FFFFFF', // --o369-inbg
  onBubbleMine: '#14324E', // --o369-owntext
  onBubbleMineMuted: '#5B7691',   // web: owntext at 62%
  onBubbleMineTint: '#1F5F9E',
  pollFillMine: '#CFE0F2',
  readTick: '#34B7F1',     // the blue double-check
  overlay: '#000000',      // full-bleed media viewer backdrop
  onOverlay: '#FFFFFF',    // controls drawn on that backdrop
  // Media editors (crop, preview tray, camera) sit on a neutral dark ground so
  // photos are judged fairly — deliberately not a themed surface.
  editorBg: '#0B1220',
  scrim: 'rgba(15,23,42,0.5)',   // behind a sheet/modal
  shadow: '#1e293b',             // shadowColor for hand-rolled shadows
  // Accent pairs for the attach sheet / status tiles.
  violet: '#7C3AED', violetBg: '#EDE9FE',
  pink: '#DB2777', pinkBg: '#FCE7F3',
  blue: '#2563EB', blueBg: '#DBEAFE',
  cyan: '#0891B2', cyanBg: '#CFFAFE',
  orange: '#EA580C', orangeBg: '#FFEDD5',
  emerald: '#15803D',
};
// ── accent variants ─────────────────────────────────────────────────────────
// ids, names and swatch pairs are the web client's own THEMES array
// (chat_app.js), so the two pickers offer the same set in the same order.
//
export const THEME_VARIANTS = [
  { id: 'clean',    name: 'Light',    swatch: ['#F4F6FA', '#DCE6F3'],
    light: { primary: '#2563A8', primaryDark: '#1F5F9E', shellAlt: '#EEF2F8' },
    accent: '#F47A20', accentDeep: '#E85D1B' },
  { id: 'ocean',    name: 'Ocean',    swatch: ['#1F5F9E', '#F47A20'],
    light: { primary: '#1F5F9E', primaryDark: '#16406E', shellAlt: '#EEF3F8' },
    accent: '#F47A20', accentDeep: '#E85D1B' },
  { id: 'emerald',  name: 'Emerald',  swatch: ['#0E8F53', '#F2A93B'],
    light: { primary: '#0E8F53', primaryDark: '#0A6B3E', shellAlt: '#ECF5EF' },
    accent: '#F2A93B', accentDeep: '#DB9426' },
  { id: 'sunset',   name: 'Sunset',   swatch: ['#C2410C', '#F59E0B'],
    light: { primary: '#C2410C', primaryDark: '#9A3412', shellAlt: '#FBF0EA' },
    accent: '#F59E0B', accentDeep: '#D97706' },
  { id: 'violet',   name: 'Violet',   swatch: ['#6D28D9', '#F472B6'],
    light: { primary: '#6D28D9', primaryDark: '#5B21B6', shellAlt: '#F3EFFB' },
    accent: '#F472B6', accentDeep: '#EC4899' },
  { id: 'graphite', name: 'Graphite', swatch: ['#334155', '#F59E0B'],
    light: { primary: '#334155', primaryDark: '#1E293B', shellAlt: '#EEF1F5' },
    accent: '#F59E0B', accentDeep: '#D97706' },
  { id: 'rose',     name: 'Rose',     swatch: ['#BE185D', '#FB7185'],
    light: { primary: '#BE185D', primaryDark: '#9D174D', shellAlt: '#FBEEF3' },
    accent: '#FB7185', accentDeep: '#F43F5E' },
];

// Web's own default (`localStorage.getItem('o369_theme') || 'clean'`).
export const DEFAULT_VARIANT = 'clean';

const VARIANT_BY_ID = Object.fromEntries(THEME_VARIANTS.map((v) => [v.id, v]));

// Compose a full palette from the shared surface set + a variant's five brand
// tokens. `link` follows the brand and bgBottom follows the wall, so the gradient
// and every link tint move with the accent choice instead of being pinned to one
// variant's blue.
function buildPalette(variantId) {
  const v = VARIANT_BY_ID[variantId] || VARIANT_BY_ID[DEFAULT_VARIANT];
  const over = v.light;
  const shellAlt = over.shellAlt || LIGHT.shellAlt;
  return {
    ...LIGHT,
    primary: over.primary,
    primaryDark: over.primaryDark,
    link: over.primary,
    accent: v.accent,
    accentDeep: v.accentDeep,
    shellAlt,
    bgBottom: shellAlt,
  };
}

// Built lazily and cached: 7 possible palettes, but a session touches one or two.
const PALETTES = new Proxy({}, {
  get(cache, key) {
    if (!cache[key]) cache[key] = buildPalette(String(key));
    return cache[key];
  },
});

const SHADOW_BASE = {
  shadowColor: '#1e293b',
  shadowOpacity: 0.07,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
};

const SCRIM_VALUE = 'rgba(15,23,42,0.5)';

// ── the active palette ──────────────────────────────────────────────────────
// Module-level on purpose: the proxies below and every themed() sheet read it
// synchronously during render, which a React context value cannot do for code
// that lives outside a component (StyleSheet blocks, helper functions).
let active = DEFAULT_VARIANT;
const listeners = new Set();

export function activeThemeKey() { return active; }

function setActive(variantId) {
  if (variantId === active) return;
  active = variantId;
  listeners.forEach((fn) => fn(variantId));
}

// ── live proxies ────────────────────────────────────────────────────────────
// ownKeys + getOwnPropertyDescriptor are implemented so `{...COLORS}` and
// `...SHADOW` (which several StyleSheet blocks do) still work.
function liveProxy(pick) {
  return new Proxy({}, {
    get: (_t, k) => pick()[k],
    has: (_t, k) => k in pick(),
    ownKeys: () => Reflect.ownKeys(pick()),
    getOwnPropertyDescriptor: (_t, k) => ({
      value: pick()[k], enumerable: true, configurable: true, writable: false,
    }),
  });
}

export const COLORS = liveProxy(() => PALETTES[active]);
// Shadow and scrim do not vary by accent, so they are plain objects again.
export const SHADOW = SHADOW_BASE;
export const SCRIM = SCRIM_VALUE;
export function scrim() { return SCRIM_VALUE; }

// ── themed stylesheets ──────────────────────────────────────────────────────
// Drop-in for StyleSheet.create: `const s = themed((C) => ({ ... }))`.
// One real StyleSheet is built per palette, lazily, and cached — so flipping the
// theme twice costs nothing after the first visit to each.
export function themed(factory) {
  const cache = {};
  const sheet = () => {
    // Keyed by the accent, so switching accent doesn't hand back the sheet built
    // for the previous one.
    if (!cache[active]) cache[active] = StyleSheet.create(factory(PALETTES[active], active));
    return cache[active];
  };
  return new Proxy({}, {
    get: (_t, k) => sheet()[k],
    has: (_t, k) => k in sheet(),
    ownKeys: () => Reflect.ownKeys(sheet()),
    getOwnPropertyDescriptor: (_t, k) => ({
      value: sheet()[k], enumerable: true, configurable: true, writable: false,
    }),
  });
}

// ── provider ────────────────────────────────────────────────────────────────

const ThemeCtx = createContext({
  variant: DEFAULT_VARIANT, key: DEFAULT_VARIANT, colors: LIGHT,
  ready: false, setVariant: () => {}, resetAppearance: () => {},
});

export function useTheme() { return useContext(ThemeCtx); }

export function ThemeProvider({ children }) {
  const [variant, setVariantState] = useState(DEFAULT_VARIANT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(K_VARIANT)
      .then((v) => { if (alive && v && VARIANT_BY_ID[v]) setVariantState(v); })
      .catch(() => {})
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  // Set BEFORE children render, so the first paint of a change is already
  // correct rather than one frame behind.
  setActive(variant);

  const setVariant = useCallback((next) => {
    setVariantState(next);
    AsyncStorage.setItem(K_VARIANT, next).catch(() => {});
  }, []);

  const resetAppearance = useCallback(() => setVariant(DEFAULT_VARIANT), [setVariant]);

  const value = useMemo(() => ({
    variant, key: variant, colors: PALETTES[variant], ready, setVariant, resetAppearance,
  }), [variant, ready, setVariant, resetAppearance]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

// For non-React code (services, utils) that wants to react to a flip.
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── static tokens (theme-independent) ───────────────────────────────────────

// Screen padding is 14 nearly everywhere; the rest are the gaps that recur.
export const SPACING = { xs: 6, sm: 8, md: 10, lg: 12, screen: 14, xl: 20 };

export const RADIUS = { sm: 8, md: 10, lg: 12, xl: 14, sheet: 22, pill: 999 };

// The type steps the screens actually use. Weights run heavy (700/800/900) —
// that bluntness is part of the look, so it is preserved rather than normalised.
export const TYPE = {
  title: { fontSize: 18, fontWeight: '900' },   // screen header title
  heading: { fontSize: 16, fontWeight: '800' }, // card / section heading
  body: { fontSize: 13.5, fontWeight: '600' },
  label: { fontSize: 12, fontWeight: '700' },
  caption: { fontSize: 11.5, fontWeight: '700' },
};

// Top inset for a screen header. Android reports a real status-bar height; iOS
// returns undefined here, so the constant covers the notch-less case and
// SafeAreaView handles the rest.
export const TOP = (StatusBar.currentHeight || 40) + 12;
