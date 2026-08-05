// APP LOGIN — the primary per-user login after the device is set up once.
//
// Number-first, the way WhatsApp does it: pick your country, type your number,
// receive a 6-digit code, and you are in. If the number is new and sign-up is
// on, it asks your name after the code and creates the account.
//
// YOU NEVER CHOOSE "SIGN IN" OR "SIGN UP". `/app_login/start` decides from the
// number alone and sends the right code, so the app has one path and the user
// has one decision — what their number is. Offering the choice would mean asking
// people to know something about their own account that the server already knows.
//
// No password is asked for anywhere in that flow. It survives only as a fallback
// on the code screen, for when WhatsApp — a single scanned session — is down.
//
// "Water flowing" look: a blue top with organic blobs + a white wavy sheet that
// holds the form; the wave gently drifts for a flowing-water feel.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Animated, Easing, Dimensions,
  Alert, Modal, FlatList,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle, Ellipse } from 'react-native-svg';
import LoginArt from '../components/LoginArt';
import { COLORS, themed } from '../theme';
import { saveSession, saveLastMobile, getLastMobile } from '../api/session';
import {
  start, verifyCode, signUp, passwordLogin,
  digitsOf, MIN_DIGITS, MAX_DIGITS,
} from '../services/appAuth';
import {
  COUNTRY_ROWS, DEFAULT_COUNTRY, countryByCode, dialOf, flagOf, matchCountry,
} from '../services/countries';
import { createLogger } from '../api/logger';

const log = createLogger('AppLogin');
const { width: SW } = Dimensions.get('window');

// Alphalize blue — buttons / links.
const WATER = COLORS.primary;

// Blue "water" wave at the top of the form sheet — clearly visible, flows down.
const WAVE_H = 92;
const WAVE_LIGHT = COLORS.primaryDark;   // lighter drifting layer
const WAVE_D =
  `M0,${WAVE_H} L0,48 ` +
  `C ${SW * 0.18},14 ${SW * 0.36},66 ${SW * 0.54},46 ` +
  `C ${SW * 0.70},28 ${SW * 0.86},60 ${SW},40 ` +
  `L ${SW},${WAVE_H} Z`;
const WAVE_ACCENT =
  `M0,${WAVE_H} L0,58 ` +
  `C ${SW * 0.22},26 ${SW * 0.42},74 ${SW * 0.60},54 ` +
  `C ${SW * 0.76},38 ${SW * 0.88},66 ${SW},50 ` +
  `L ${SW},${WAVE_H} Z`;

export default function AppLoginScreen({ onLogin, onNeedSetup, serverMoved, noServerReason }) {
  const insets = useSafeAreaInsets();            // clear the phone's nav/gesture bar
  const [step, setStep] = useState('mobile');   // mobile | code | name | password
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // What the server decided this number is: 'login' (known) or 'signup' (new).
  // Held rather than re-derived, because the code screen and the name screen
  // both need it and asking twice could get two different answers.
  const [mode, setMode] = useState('login');
  // The code was authorised but WhatsApp did not deliver it. Kept apart from
  // `error` because nothing the user can retype will fix it.
  const [notSent, setNotSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);   // seconds left before "Resend" is allowed

  // Country. The list is BUNDLED, so the picker works with no server, no
  // network and no loading state — see services/countries.js. Identified by ISO
  // code, since res.country ids differ between databases.
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState('');
  const dial = dialOf(country);

  // Tick the resend cooldown down to 0 while the code step is showing.
  useEffect(() => {
    if (step !== 'code' || resendIn <= 0) return;
    const id = setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [step, resendIn]);

  // Filtered locally, over a bundled list. This used to be fetched from
  // /app_login/config, which meant the picker on the very FIRST screen of the
  // app could not be opened until a server had answered — so a connection
  // problem showed up as a dropdown that did nothing when tapped, with nothing
  // to say why. Dial codes never change; asking a server for them bought
  // nothing and cost the one screen that has to work when nothing else does.
  const visibleCountries = useMemo(() => {
    const q = countryQuery;
    return COUNTRY_ROWS.filter((c) => matchCountry(c, q));
  }, [countryQuery]);

  // Pre-fill the last number that signed in on this device. It matters most
  // after the admin moves the app to another server: the session is dropped, and
  // without this the user would face an empty form with no idea why.
  useEffect(() => {
    let alive = true;
    getLastMobile().then((m) => {
      if (alive && m) setMobile(m);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Entrance — the form "flows" in (fade + slide up with a springy lift) when the
  // screen appears, e.g. right after the Odoo device-setup login hands off here.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }).start();
  }, []);

  // Per-step transition (mobile → password → otp → setpw) — replays on step change.
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [step]);

  // Water flow — the accent wave drifts gently left/right forever.
  const waveX = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(waveX, { toValue: 1, duration: 3800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(waveX, { toValue: 0, duration: 3800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])).start();
  }, []);

  const fail = (msg) => { log.warn('login step failed', msg); setError(msg); setBusy(false); };

  // Hidden admin gesture: tap the 369 logo 7 times (within ~1.5s between taps)
  // to open the Odoo device-setup page. Lives only on this sign-in screen.
  const tapCount = useRef(0);
  const tapTimer = useRef(null);
  const onLogoTap = () => {
    tapCount.current += 1;
    log.info('logo tap', tapCount.current);
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => { tapCount.current = 0; }, 1500);
    if (tapCount.current >= 7) {
      tapCount.current = 0;
      if (tapTimer.current) clearTimeout(tapTimer.current);
      log.info('logo 7-tap → open device setup');
      onNeedSetup();
    }
  };

  // With no server configured there is nothing to ask. Attempting anyway used to
  // produce "This number is not registered", which blames the number for the
  // admin not having set a server up and sends the user to ask for the wrong
  // fix. Returns the sentence to show, or null when there is a server.
  function serverProblem() {
    if (!noServerReason) return null;
    log.info('login blocked — no server', { reason: noServerReason });
    return noServerReason === 'unconfigured'
      ? 'This app has no server set up yet. Contact your admin.'
      : "Can't reach the server. Check your connection, or contact your admin.";
  }

  // Sign in as `user`, remembering the number so the field is already filled if
  // the admin later moves this app to another server, which drops the session.
  async function enterApp(user) {
    await saveSession(user);
    await saveLastMobile(digitsOf(mobile));
    onLogin(user);
  }

  // Ask the server what this number is, which also sends the code.
  async function requestCode({ resend = false } = {}) {
    const m = digitsOf(mobile);
    setBusy(true); setError(''); setNotSent(false);
    try {
      const res = await start(m, { countryCode: country });
      if (res.mode === 'blocked') return fail(res.error || 'Could not continue.');
      setMode(res.mode);
      setNotSent(!res.sent);
      // The server's own throttle window when it gave one, so the button
      // re-enables exactly when another code would actually be issued rather
      // than at a number this screen made up.
      setResendIn(res.retryAfter || 30);
      // Only ever present while the server's dev auto-fill switch is on. It is
      // what makes this flow testable before WhatsApp has been connected.
      if (res.devCode) {
        log.warn('dev auto-fill is ON — code returned by the server');
        setCode(res.devCode);
      } else if (!resend) {
        setCode('');
      }
      if (!resend) { setFullName(''); setStep('code'); }
      setBusy(false);
    } catch (e) { fail('Could not reach the server. Try again.'); }
  }

  function continueMobile() {
    const m = digitsOf(mobile);
    if (m.length < MIN_DIGITS || m.length > MAX_DIGITS) {
      return fail('Enter your mobile number.');
    }
    const problem = serverProblem();
    if (problem) return fail(problem);

    // WhatsApp confirms the number before sending, and it is worth copying: a
    // mistyped digit otherwise sends a code to a stranger and leaves this user
    // waiting for a message that is never coming. One dialog, and the mistake
    // is caught while it is still on screen.
    Alert.alert(
      'Is this number correct?',
      `We will send a code to\n\n+${dial} ${m}`,
      [
        { text: 'Edit', style: 'cancel' },
        { text: 'Yes', onPress: () => requestCode() },
      ],
    );
  }

  async function submitCode() {
    const c = digitsOf(code);
    if (c.length < 4) return fail('Enter the code from WhatsApp.');
    // A new number needs a name before the account can exist, and the code is
    // checked by the sign-up call itself — so there is nothing to verify here.
    if (mode === 'signup') { setError(''); return setStep('name'); }

    setBusy(true); setError('');
    try {
      const res = await verifyCode(mobile, c, { dial });
      if (!res.ok) return fail(res.error || 'Incorrect or expired code.');
      log.info('signed in by code', res.user?.username);
      await enterApp(res.user);
    } catch (e) { fail('Could not verify. Try again.'); }
  }

  async function submitName() {
    const n = fullName.trim();
    if (!n) return fail('Enter your name.');
    setBusy(true); setError('');
    try {
      // No password. That is the whole point of this path — see the header.
      const res = await signUp(mobile, {
        code: digitsOf(code), name: n, countryCode: country, dial,
      });
      if (!res.ok) {
        // The account may exist even when the session did not take. Say so and
        // send them back to the number, rather than implying it all failed and
        // inviting a second attempt that will be refused as a duplicate.
        if (res.created) { setStep('mobile'); setCode(''); }
        return fail(res.error || 'Could not create the account.');
      }
      log.info('account created', res.user?.username);
      await enterApp(res.user);
    } catch (e) { fail('Could not create the account. Try again.'); }
  }

  async function doPasswordLogin() {
    if (!pw) return fail('Enter your password.');
    const problem = serverProblem();
    if (problem) return fail(problem);
    setBusy(true); setError('');
    try {
      const res = await passwordLogin(mobile, pw, { dial });
      if (!res.ok) return fail(res.error || 'Invalid mobile number or password.');
      log.info('signed in by password', res.user?.username);
      await enterApp(res.user);
    } catch (e) { fail('Login failed. Try again.'); }
  }

  function pickCountry(c) {
    setCountry(c.code);
    setPickerOpen(false);
    setCountryQuery('');
  }

  const enterStyle = {
    opacity: enter.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }),
    transform: [
      { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) },
      { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
    ],
  };
  const stepStyle = {
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  };

  // One header per step — avoids showing "Welcome back" AND a step title together.
  const HEADS = {
    mobile: { t: 'Welcome 👋', s: 'Enter your mobile number to continue' },
    code: {
      t: 'Enter the code',
      // Says WHERE it went. A code screen that does not name the number it was
      // sent to is the one place a mistyped digit hides.
      s: `We sent a 6-digit code on WhatsApp to +${dial} ${digitsOf(mobile)}`,
    },
    name: { t: "What's your name?", s: 'This is how people will see you' },
    password: { t: 'Enter password', s: `+${dial} ${digitsOf(mobile)}` },
  };
  const head = HEADS[step] || HEADS.mobile;

  return (
    <View style={s.root}>
      <StatusBar style="dark" />

      {/* Illustration up top */}
      <View style={[s.heroWrap, { paddingTop: insets.top + 10 }]}>
        <LoginArt width={SW * 0.62} height={SW * 0.62 * (220 / 300)} />
      </View>

      {/* White wave sheet holding the form — the water flow ends here, at the form */}
      <View style={s.sheet}>
        {/* drifting accent wave (flow) */}
        <Animated.View
          pointerEvents="none"
          style={[s.waveLayer, { transform: [{ translateX: waveX.interpolate({ inputRange: [0, 1], outputRange: [-16, 16] }) }] }]}
        >
          <Svg width={SW} height={WAVE_H} viewBox={`0 0 ${SW} ${WAVE_H}`}>
            <Path d={WAVE_ACCENT} fill={WAVE_LIGHT} opacity={0.8} />
          </Svg>
        </Animated.View>
        {/* main blue water wave */}
        <Svg width={SW} height={WAVE_H} style={s.waveLayer} pointerEvents="none" viewBox={`0 0 ${SW} ${WAVE_H}`}>
          <Path d={WAVE_D} fill={WATER} />
        </Svg>

        <View style={s.sheetBody}>
          {/* faint water blobs so the lower half isn't plain white */}
          <Svg style={s.bottomDeco} width={SW} height={180} pointerEvents="none" viewBox={`0 0 ${SW} 180`}>
            <Ellipse cx={SW * 0.20} cy={160} rx={130} ry={84} fill={WATER} opacity={0.05} />
            <Ellipse cx={SW * 0.92} cy={126} rx={104} ry={72} fill={WATER} opacity={0.06} />
            <Circle cx={SW * 0.55} cy={174} r={62} fill={WATER} opacity={0.04} />
          </Svg>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={s.formScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Animated.View style={enterStyle}>
                {/* 369 logo under the wave — tap it 7× → Odoo device setup (hidden) */}
                <TouchableOpacity activeOpacity={1} onPress={onLogoTap} style={s.logoWrap}>
                  <Image source={require('../assets/logo369.png')} style={s.logo} resizeMode="contain" />
                </TouchableOpacity>

                {/* The admin repointed this app at a different server, so the old
                    session was dropped. Being signed out with no explanation
                    reads as a bug, so it is stated plainly. */}
                {!!serverMoved && (
                  <View style={s.moved}>
                    <Text style={s.movedTxt}>
                      Your workspace has moved to a new server. Please sign in again.
                    </Text>
                  </View>
                )}

                {/* No server to sign in against. Shown instead of letting the
                    attempt fail with a network error, and worded as the admin's
                    job because the user cannot fix an address they never see.

                    The two reasons say DIFFERENT things on purpose: telling an
                    admin the server is unreachable when it answered perfectly
                    well sends them hunting a network fault that isn't there. */}
                {!!noServerReason && (
                  <View style={s.noServer}>
                    <Text style={s.noServerTxt}>
                      {noServerReason === 'unconfigured'
                        ? 'This app has no server set up yet — contact your admin.'
                        : "Can't reach the server — contact your admin."}
                    </Text>
                  </View>
                )}
                <View style={s.decorRow}>
                  <View style={s.decorLine} />
                  <Text style={s.decorTxt}>
                    <Text style={{ color: COLORS.navy }}>Track. </Text>
                    <Text style={{ color: COLORS.primary }}>Measure. </Text>
                    <Text style={{ color: COLORS.green }}>Achieve.</Text>
                  </Text>
                  <View style={s.decorLine} />
                </View>

                <Animated.View style={stepStyle}>
                  {/* One header, changes per step (no duplicate titles) */}
                  <Text style={s.welcome}>{head.t}</Text>
                  <Text style={s.welcomeSub}>{head.s}</Text>

                  {step === 'mobile' && (
                    <View style={s.form}>
                      {/* Country above the number, as WhatsApp has it. The dial
                          code is not typed — it is a consequence of the country,
                          and letting both be typed is how they end up disagreeing. */}
                      {/* Always works. The list is bundled, so this opens with
                          no server, no network and no loading state. */}
                      <TouchableOpacity
                        style={s.field} activeOpacity={0.7}
                        onPress={() => setPickerOpen(true)}
                      >
                        <Text style={s.countryFlag}>{flagOf(country)}</Text>
                        <Text style={s.countryTxt} numberOfLines={1}>
                          {countryByCode(country)?.name || 'India'}
                        </Text>
                        <Ionicons name="chevron-down" size={16} color={COLORS.muted} />
                      </TouchableOpacity>

                      <View style={s.field}>
                        <Ionicons name="call-outline" size={18} color={COLORS.muted} />
                        <Text style={s.dialPrefix}>+{dial}</Text>
                        <TextInput
                          style={s.input} placeholder="Mobile number" placeholderTextColor={COLORS.faint}
                          keyboardType="phone-pad" value={mobile}
                          onChangeText={(t) => setMobile(digitsOf(t).slice(0, MAX_DIGITS))}
                          maxLength={MAX_DIGITS} autoFocus
                        />
                      </View>
                      {!!error && <Text style={s.err}>{error}</Text>}
                      <TouchableOpacity style={s.primaryBtn} onPress={continueMobile} disabled={busy} activeOpacity={0.9}>
                        {busy ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={s.primaryTxt}>Continue</Text>}
                      </TouchableOpacity>
                    </View>
                  )}

                  {step === 'code' && (
                    <View style={s.form}>
                      {/* The server let them through but WhatsApp did not deliver.
                          Said plainly, because no amount of retyping fixes it and
                          silence here is the worst failure in the whole flow —
                          the user waits indefinitely for a message nobody sent. */}
                      {notSent && (
                        <View style={s.pwWarn}>
                          <Ionicons name="alert-circle" size={16} color={COLORS.red} />
                          <Text style={s.pwWarnTxt}>
                            The code couldn’t be sent. Contact your admin — WhatsApp may not be
                            connected on the server.
                          </Text>
                        </View>
                      )}
                      <View style={s.field}>
                        <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.muted} />
                        <TextInput
                          style={[s.input, s.codeInput]} placeholder="6-digit code"
                          placeholderTextColor={COLORS.faint}
                          keyboardType="number-pad" maxLength={6} value={code}
                          onChangeText={(t) => setCode(digitsOf(t).slice(0, 6))} autoFocus
                        />
                      </View>
                      {!!error && <Text style={s.err}>{error}</Text>}
                      <TouchableOpacity style={s.primaryBtn} onPress={submitCode} disabled={busy} activeOpacity={0.9}>
                        {busy ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={s.primaryTxt}>Continue</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => requestCode({ resend: true })} style={{ marginTop: 12 }} disabled={busy || resendIn > 0}>
                        <Text style={[s.link, (busy || resendIn > 0) && s.linkDisabled]}>
                          {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                        </Text>
                      </TouchableOpacity>
                      {/* Only for someone who already HAS a password, which now
                          means someone who chose to set one. Hidden on sign-up,
                          where the account does not exist yet. */}
                      {mode === 'login' && (
                        <TouchableOpacity onPress={() => { setStep('password'); setError(''); setPw(''); }} style={{ marginTop: 10 }}>
                          <Text style={s.linkMuted}>Use my password instead</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity onPress={() => { setStep('mobile'); setCode(''); setError(''); setNotSent(false); }} style={{ marginTop: 10 }}>
                        <Text style={s.linkMuted}>← Use a different number</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {step === 'name' && (
                    <View style={s.form}>
                      <View style={s.field}>
                        <Ionicons name="person-outline" size={18} color={COLORS.muted} />
                        <TextInput
                          style={s.input} placeholder="Your name" placeholderTextColor={COLORS.faint}
                          value={fullName} onChangeText={setFullName}
                          autoFocus autoCapitalize="words" maxLength={60}
                        />
                      </View>
                      {!!error && <Text style={s.err}>{error}</Text>}
                      <TouchableOpacity style={s.primaryBtn} onPress={submitName} disabled={busy} activeOpacity={0.9}>
                        {busy ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={s.primaryTxt}>Create account</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => { setStep('code'); setError(''); }} style={{ marginTop: 12 }}>
                        <Text style={s.linkMuted}>← Back</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {step === 'password' && (
                    <View style={s.form}>
                      <View style={s.field}>
                        <Ionicons name="lock-closed-outline" size={18} color={COLORS.muted} />
                        <TextInput
                          style={s.input} placeholder="Password" placeholderTextColor={COLORS.faint}
                          secureTextEntry={!showPw} value={pw} onChangeText={setPw} autoFocus
                        />
                        <TouchableOpacity onPress={() => setShowPw((v) => !v)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                          <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={COLORS.muted} />
                        </TouchableOpacity>
                      </View>
                      {!!error && <Text style={s.err}>{error}</Text>}
                      <TouchableOpacity style={s.primaryBtn} onPress={doPasswordLogin} disabled={busy} activeOpacity={0.9}>
                        {busy ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={s.primaryTxt}>Log In</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => { setStep('code'); setError(''); }} style={{ marginTop: 14 }}>
                        <Text style={s.link}>← Use the WhatsApp code</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                </Animated.View>
              </Animated.View>
            </ScrollView>
          </KeyboardAvoidingView>

          {/* Footer — pinned above the phone's nav/gesture bar. */}
          <View style={[s.footer, { paddingBottom: 14 + insets.bottom }]}>
            <Ionicons name="shield-checkmark" size={13} color={COLORS.muted} />
            <Text style={s.footerTxt}>Secure login · Alphalize · v1.0</Text>
          </View>
        </View>
      </View>

      {/* A CENTRED CARD, not a full page. Choosing a dial code is a small
          decision inside signing in, and a screen that replaces everything makes
          it feel like a step of its own — you lose sight of the number you were
          part-way through typing.

          Searchable, because the list is every country there is: scrolling to
          Oman past two hundred entries is not a picker. Matches name, dial code
          or ISO code, so "968", "om" and "Oman" all find it. The nine places
          these users actually are sit at the top so the common cases need no
          typing at all. */}
      <Modal
        visible={pickerOpen} animationType="fade" transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        {/* Tapping the dimmed area closes it — the expected way out of a card. */}
        <TouchableOpacity
          style={s.pickerBackdrop} activeOpacity={1}
          onPress={() => setPickerOpen(false)}
        >
          {/* Swallows taps so they do not reach the backdrop and close it. */}
          <TouchableOpacity style={s.pickerCard} activeOpacity={1}>
            <View style={s.pickerHead}>
              <Text style={s.pickerTitle}>Choose a country</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={22} color={COLORS.muted} />
              </TouchableOpacity>
            </View>
            <View style={[s.field, { marginHorizontal: 16, marginBottom: 8 }]}>
              <Ionicons name="search" size={18} color={COLORS.muted} />
              <TextInput
                style={s.input} placeholder="Search" placeholderTextColor={COLORS.faint}
                value={countryQuery} onChangeText={setCountryQuery} autoCorrect={false}
              />
            </View>
            <FlatList
              data={visibleCountries}
              keyExtractor={(c) => c.code}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.countryRow, item.code === country && s.countryRowOn]}
                  onPress={() => pickCountry(item)} activeOpacity={0.7}
                >
                  <Text style={s.countryFlag}>{flagOf(item.code)}</Text>
                  <Text style={s.countryName} numberOfLines={1}>{item.name}</Text>
                  <Text style={s.countryDial}>+{item.dial}</Text>
                  {item.code === country && (
                    <Ionicons name="checkmark" size={18} color={COLORS.primary} />
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={s.pickerEmpty}>No country matches that.</Text>
              }
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const s = themed((C) => ({
  root: { flex: 1, backgroundColor: COLORS.slate50 },
  heroWrap: { width: SW, backgroundColor: COLORS.slate50, alignItems: 'center', justifyContent: 'center', paddingBottom: 24 },

  sheet: { flex: 1, marginTop: -24, backgroundColor: 'transparent' },
  waveLayer: { position: 'absolute', top: 0, left: 0 },
  sheetBody: { flex: 1, backgroundColor: COLORS.card, marginTop: WAVE_H - 1 },
  bottomDeco: { position: 'absolute', left: 0, right: 0, bottom: 0 },

  // Sit the form near the top (just under the water flow), moved up.
  formScroll: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 20 },
  form: { width: '100%' },
  logoWrap: { alignSelf: 'center', marginBottom: 2 },
  logo: { width: 168, height: 90 },
  decorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 16 },
  decorLine: { width: 22, height: 1.5, backgroundColor: COLORS.line, borderRadius: 1 },
  decorTxt: { fontSize: 13, fontWeight: '800' },
  welcome: { fontSize: 23, fontWeight: '900', color: C.navy },
  welcomeSub: { fontSize: 13.5, color: C.muted, marginTop: 4, marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '900', color: C.navy },
  sub: { fontSize: 13.5, color: C.muted, marginTop: 4, marginBottom: 16 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.slate50,
    borderWidth: 1.5, borderColor: COLORS.slate50, borderRadius: 12, paddingHorizontal: 14, height: 54, marginBottom: 12,
  },
  input: { flex: 1, fontSize: 15.5, color: C.ink, height: '100%' },
  dialPrefix: { fontSize: 15.5, fontWeight: '700', color: C.ink, marginRight: -4 },
  // Wide tracking so six digits read as six separate things to check against the
  // message, rather than one number to glance at.
  codeInput: { letterSpacing: 6, fontWeight: '700' },
  countryTxt: { flex: 1, fontSize: 15.5, color: C.ink, fontWeight: '600' },
  err: { color: C.red, fontSize: 13, marginBottom: 8 },
  // Informational, not an error — the user did nothing wrong, so it is not red.
  moved: {
    backgroundColor: C.tintBg, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14, marginBottom: 14,
  },
  movedTxt: { color: C.primary, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  // Same shape as `moved`, red — this one IS a fault, not just news.
  noServer: {
    backgroundColor: C.redBg, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14, marginBottom: 14,
  },
  noServerTxt: { color: C.red, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  pwWarn: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: COLORS.redBg, borderWidth: 1, borderColor: C.red, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 14 },
  pwWarnTxt: { flex: 1, color: C.red, fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
  primaryBtn: { backgroundColor: WATER, borderRadius: 12, height: 54, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryTxt: { color: COLORS.onPrimary, fontSize: 16.5, fontWeight: '800' },
  link: { color: WATER, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  linkDisabled: { color: C.faint },
  linkMuted: { color: C.muted, fontSize: 13.5, fontWeight: '600', textAlign: 'center' },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 10 },
  footerTxt: { fontSize: 12, color: C.muted, fontWeight: '600' },

  pickerBackdrop: {
    flex: 1, backgroundColor: 'rgba(15,23,42,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  // maxHeight keeps it a card rather than creeping to full height on a long
  // list; maxWidth stops it stretching edge to edge on a tablet.
  pickerCard: {
    width: '100%', maxWidth: 400, maxHeight: '78%',
    backgroundColor: C.card, borderRadius: 18, paddingTop: 4, paddingBottom: 8,
    overflow: 'hidden',
  },
  pickerHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  pickerTitle: { fontSize: 17, fontWeight: '800', color: C.navy },
  countryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 18, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  countryRowOn: { backgroundColor: C.tintBg },
  // Sized up: a flag emoji at body size is an unreadable smudge.
  countryFlag: { fontSize: 22 },
  countryName: { flex: 1, fontSize: 15, color: C.ink },
  countryDial: { fontSize: 14.5, color: C.muted, fontWeight: '700' },
  pickerEmpty: { textAlign: 'center', color: C.muted, fontSize: 14, paddingVertical: 28 },
}));
