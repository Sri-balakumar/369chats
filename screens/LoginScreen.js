// WELCOME — 369 ai.Biz layout. 369 logo → hero photo → white card with the
// alphalize welcome, a decorative divider line, and a single "Tap to Enter Login
// Page" button that opens the Odoo connection flow (URL → database → login).
import React, { useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Image,
  KeyboardAvoidingView, Platform, Animated, Dimensions,
  StatusBar as RNStatusBar,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { COLORS, themed } from '../theme';

const { width: SW } = Dimensions.get('window');
const HERO_H = SW * (1304 / 1283);     // full composite hero (369 logo baked in)
const CARD_OVERLAP = SW * 0.16;        // card pulls up over the hero bottom
const TOP = (RNStatusBar.currentHeight || 0) + 6;
// clear the device's bottom bar (Android 3-button nav ~48dp / iOS home indicator)
const BOTTOM_PAD = Platform.OS === 'android' ? 62 : 34;

// Curved (wave) top edge of the white card. The white fill + main green→blue
// line stay low on the left (so "Welcome" sits tight). The blue companion line
// is drawn ON TOP of the card, so it can sweep down on the right (a real
// flowing second line) without pushing the content down.
const CURVE_H = 56;
const CURVE_D =
  `M0,${CURVE_H} L0,46 ` +
  `C ${SW * 0.14},46 ${SW * 0.30},10 ${SW * 0.50},20 ` +
  `C ${SW * 0.68},28 ${SW * 0.84},46 ${SW},40 ` +
  `L ${SW},${CURVE_H} Z`;
const CURVE_EDGE =
  `M0,46 C ${SW * 0.14},46 ${SW * 0.30},10 ${SW * 0.50},20 ` +
  `C ${SW * 0.68},28 ${SW * 0.84},46 ${SW},40`;
// Second (blue) companion line — its START joins the main line (at the mid anchor
// SW*0.50,20) and its END joins the main line's end (SW,40); bows down between.
const CURVE_EDGE2 =
  `M ${SW * 0.50},20 C ${SW * 0.66},34 ${SW * 0.84},50 ${SW},40`;

export default function LoginScreen({ goConnect }) {
  // Man photo appears first, then the welcome card follows a split-second later.
  // Triggered off the hero image finishing load so the man is always first
  // (never "welcome first, then image"). Fallback timer in case onLoad is missed.
  const heroIn = useRef(new Animated.Value(0)).current;
  const cardIn = useRef(new Animated.Value(0)).current;
  const started = useRef(false);
  const runEnter = () => {
    if (started.current) return;
    started.current = true;
    Animated.stagger(130, [
      Animated.timing(heroIn, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.timing(cardIn, { toValue: 1, duration: 320, useNativeDriver: true }),
    ]).start();
  };
  useEffect(() => {
    const t = setTimeout(runEnter, 450);
    return () => clearTimeout(t);
  }, []);

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}
      >
        {/* status-bar pad (matches hero bg) + single hero image (369 baked in) */}
        <View style={s.statusPad} />
        <Animated.View style={[s.heroWrap, { opacity: heroIn }]}>
          {/* Plain hero. The animated chevrons that used to sweep toward "KRA" and
              "KPI" labels went with FlowOverlay — their coordinates were pinned to
              that artwork. */}
          <Image source={require('../assets/loginhero.png')} style={s.hero} resizeMode="cover" onLoad={runEnter} />
        </Animated.View>

        {/* White card with a curved (wave) top edge */}
        <Animated.View style={[s.card, { opacity: cardIn }]}>
          <Svg width={SW} height={CURVE_H} viewBox={`0 0 ${SW} ${CURVE_H}`}>
            <Defs>
              <LinearGradient id="cg" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={COLORS.green} />
                <Stop offset="0.55" stopColor={COLORS.cyan} />
                <Stop offset="1" stopColor={COLORS.primary} />
              </LinearGradient>
            </Defs>
            {/* The sheet the form sits on — follows the card colour, or the
                login page keeps a white slab under a dark form. */}
            <Path d={CURVE_D} fill={COLORS.card} />
            <Path d={CURVE_EDGE} stroke="url(#cg)" strokeWidth={4.5} fill="none" strokeLinecap="round" />
          </Svg>
          <View style={s.cardBody}>
          {/* faint 369 watermark behind the welcome content */}
          <Image source={require('../assets/logo369.png')} style={s.watermark} resizeMode="contain" pointerEvents="none" />
          {/* welcome (centered) */}
          <Text style={s.welcomeTo}>Welcome to</Text>
          <Text style={s.welcomeBig}>369Chats</Text>

          {/* decorative divider */}
          <View style={s.decorRow}>
            <View style={s.decorLine} />
            <Text style={s.decorTxt}>
              <Text style={{ color: COLORS.navy }}>Connect. </Text>
              <Text style={{ color: COLORS.primary }}>Share. </Text>
              <Text style={{ color: COLORS.green }}>Deliver.</Text>
            </Text>
            <View style={s.decorLine} />
          </View>

          <Text style={s.tagline}>
            Sign in to your workspace to get started.
          </Text>

          {/* single entry point → Odoo connection / login flow */}
          <TouchableOpacity style={s.loginBtn} onPress={goConnect} activeOpacity={0.9}>
            <Text style={s.loginTxt}>Tap to Enter Login Page</Text>
            <Ionicons name="arrow-forward" size={20} color={COLORS.onPrimary} style={{ marginLeft: 10 }} />
          </TouchableOpacity>
          </View>

          {/* blue companion line, drawn on top so it can flow down the right */}
          <Svg style={s.curveLine2} width={SW} height={68} viewBox={`0 0 ${SW} 68`} pointerEvents="none">
            <Path d={CURVE_EDGE2} stroke={COLORS.primary} strokeWidth={2.5} fill="none" strokeLinecap="round" opacity={0.85} />
          </Svg>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = themed((C) => ({
  root: { flex: 1, backgroundColor: COLORS.shellAlt },

  statusPad: { height: TOP, backgroundColor: COLORS.shellAlt },
  heroWrap: { width: SW, height: HERO_H },
  hero: { width: SW, height: HERO_H },

  card: { flex: 1, marginTop: -CARD_OVERLAP, backgroundColor: 'transparent' },
  cardBody: {
    flex: 1, backgroundColor: COLORS.card, marginTop: -8,
    paddingHorizontal: 24, paddingTop: 18, paddingBottom: BOTTOM_PAD,
  },
  curveLine2: { position: 'absolute', top: 0, left: 0 },

  // Faint centered watermark behind the welcome text.
  watermark: {
    position: 'absolute', alignSelf: 'center', top: 24,
    width: SW * 0.7, height: SW * 0.42, opacity: 0.06,
  },

  welcomeTo: { fontSize: 14.5, color: C.ink, fontWeight: '600', textAlign: 'center' },
  welcomeBig: { fontSize: 23, fontWeight: '900', color: C.navy, marginTop: 1, textAlign: 'center' },

  decorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8, marginBottom: 14 },
  decorLine: { width: 26, height: 1.5, backgroundColor: COLORS.line, borderRadius: 1 },
  decorTxt: { fontSize: 14, fontWeight: '800' },

  tagline: { fontSize: 14, color: C.muted, lineHeight: 21, marginBottom: 22 },

  loginBtn: {
    flexDirection: 'row', backgroundColor: C.primary, borderRadius: 13, height: 54,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 5,
  },
  loginTxt: { color: COLORS.onPrimary, fontSize: 16.5, fontWeight: '800', letterSpacing: 0.3 },
}));
