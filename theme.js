// 369 ai.Biz / alphalize brand — navy + royal blue on a light background.
//
// COLORS and SHADOW are the original exports and must keep their exact shape —
// 30+ files import { COLORS, SHADOW } from '../theme'. Everything below them was
// added when the design system in components/ui/ was extracted: those values were
// already in the app, just hardcoded and re-typed in every screen.
import { StatusBar } from 'react-native';

export const COLORS = {
  primary: '#1E40AF',     // Login button (royal blue)
  primaryDark: '#1B3A8F',
  navy: '#16306B',        // "Welcome Back" / headings
  link: '#2563EB',        // links (Forgot / Sign Up)
  ink: '#1F2937',
  muted: '#6B7280',
  faint: '#9CA3AF',
  bg: '#F7F9FC',
  card: '#FFFFFF',
  line: '#E5E9F0',
  field: '#FFFFFF',
  wave: '#DCE7FB',
  waveDeep: '#C7D8F7',
  green: '#16A34A', greenBg: '#DCFCE7',
  amber: '#D97706', amberBg: '#FEF3C7',
  red: '#DC2626', redBg: '#FEE2E2',

  // ---- added during the design-system extraction ----
  // The two app-background gradient stops (also exported by components/GradientBackground).
  bgTop: '#EAF2FF',
  bgBottom: '#C7DDF7',
  // Solid fallbacks painted UNDER the gradient so a fade-in never flashes black/white.
  shell: '#EAF2FF',        // every screen's root backgroundColor
  shellAlt: '#EEF2FB',     // ScreenTransition + the App.js gate loader
  // Slate ramp used raw across the app for dense data rows.
  slate900: '#0F172A',
  slate700: '#334155',
  slate500: '#64748B',
  slate400: '#94A3B8',
  slate100: '#F1F5F9',
  slate50: '#F8FAFC',
  // Banner borders — the tints that pair with greenBg / redBg.
  greenLine: '#A7F3D0',
  redLine: '#FCA5A5',
};

export const SHADOW = {
  shadowColor: '#1e293b',
  shadowOpacity: 0.07,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
};

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

// Modal/sheet backdrop. The app used 0.45–0.55 interchangeably; 0.5 is the median
// and now the single value.
export const SCRIM = 'rgba(15,23,42,0.5)';

// Top inset for a screen header. Android reports a real status-bar height; iOS
// returns undefined here, so the constant covers the notch-less case and
// SafeAreaView handles the rest.
export const TOP = (StatusBar.currentHeight || 40) + 12;
