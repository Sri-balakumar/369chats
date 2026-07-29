// GOOGLE MEET — the admin config panel, ported from the web client so the two
// clients configure the same thing the same way. Mirrors chat_app.js's
// `settingsView === 'gmeet'` pane: connection status, Google credentials, the
// redirect URI to paste into Google, behaviour (triggers / scope / admins-only),
// Save, Connect, and the first-time setup steps.
//
// Everything here writes ir.config_parameter rows through /chat/gmeet/config,
// which is admin-only server-side; this screen is also only reachable when
// gmeetStatus().isAdmin, so the two agree.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { COLORS, SHADOW, RADIUS, SPACING, TOP, themed } from '../theme';
import { Screen, Loader, EmptyState, ChipRow, Accordion, emptyWrap, Switch } from '../components/ui';
import * as chat from '../services/chat';
import { getConnection } from '../api/session';
import { createLogger } from '../api/logger';

const log = createLogger('GmeetSettings');

// Server accepts exactly these three (chat_api.py validates the set).
const SCOPES = [
  { key: 'both', label: 'Groups & 1:1' },
  { key: 'groups', label: 'Groups only' },
  { key: 'direct', label: '1:1 only' },
];

const HELP = [
  'Go to console.cloud.google.com → create a project (any name).',
  'Search Google Calendar API → click Enable.',
  'Open OAuth consent screen → External → add your host Gmail as a test user (or publish the app).',
  'Open Credentials → Create OAuth client ID → Web application.',
  'In Authorized redirect URIs, paste the Redirect URI shown above.',
  'Copy the Client ID + Client Secret into the boxes here → Save settings.',
  'Tap Connect Google account → sign in with your host Gmail → Allow.',
];

// Status → form. Kept outside the component so the loader's identity is stable.
const shape = (st) => ({
  clientId: st.clientId || '',
  clientSecret: '',                       // write-only; never comes back
  triggers: (st.triggers || []).join(', '),
  scope: st.scope || 'both',
  adminOnly: st.adminOnly !== false,
  baseUrl: st.baseUrl || '',
});

export default function GmeetSettingsScreen({ onBack }) {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [serverUrl, setServerUrl] = useState('');

  // The form, plus the snapshot it was loaded from — Save stays disabled until
  // they differ, the same "dirty" rule the web panel uses.
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const st = await chat.gmeetStatus({ force: true });
      setStatus(st);
      const f = shape(st);
      setForm(f);
      setSaved(JSON.stringify(f));
    } catch (e) {
      log.warn('gmeet status failed', e?.message);
      setError(e?.message || 'Could not load the Google Meet settings.');
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { serverUrl: url } = await getConnection();
      setServerUrl(url || '');
      await load();
      setLoading(false);
    })();
  }, [load]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = !!form && JSON.stringify(form) !== saved;

  // A base URL typed into the form wins over what the server last resolved, so
  // the value updates as it is edited — that is what gets pasted into Google.
  const redirectUri = useMemo(
    () => chat.gmeetRedirectUri(form?.baseUrl, status?.redirectUri),
    [form?.baseUrl, status?.redirectUri],
  );

  const save = useCallback(async () => {
    if (!form) return;
    setSaving(true);
    try {
      await chat.saveGmeetConfig(form);
      const st = await chat.gmeetStatus({ force: true });
      setStatus(st);
      // Keep what was typed, but clear the secret and re-baseline: the server
      // has it now and will never hand it back.
      const next = { ...form, clientSecret: '' };
      setForm(next);
      setSaved(JSON.stringify(next));
      Alert.alert('Saved', 'Google Meet settings updated.');
    } catch (e) {
      Alert.alert('Save failed', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [form]);

  // /chat/gmeet/oauth/start is auth='user' and the browser keeps its own cookies,
  // separate from the app's — so Odoo's login page comes first. The flow ends on
  // /odoo with no deep link back, so re-read status once the browser closes.
  const connect = useCallback(async () => {
    if (!serverUrl) { Alert.alert('Not set up', 'This device has no server configured.'); return; }
    if (dirty) {
      Alert.alert('Save first', 'Save your Client ID and Secret before connecting, or Google will reject the sign-in.');
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(chat.gmeetOauthStartUrl(serverUrl));
    } catch (e) {
      Alert.alert('Could not open the browser', e?.message || 'Please try again.');
      return;
    }
    chat.invalidateGmeetStatus();
    await load();
  }, [serverUrl, dirty, load]);

  if (loading) {
    return (
      <Screen>
        <Head onBack={onBack} />
        <Loader />
      </Screen>
    );
  }

  if (error || !form) {
    return (
      <Screen>
        <Head onBack={onBack} />
        <View style={emptyWrap}>
          <EmptyState icon="alert-circle-outline" tone="error" title={error || 'Unavailable'} onRetry={load} />
        </View>
      </Screen>
    );
  }

  const connected = !!status?.connected;

  return (
    <Screen>
      <Head onBack={onBack} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: SPACING.xl + insets.bottom }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Connection state. Note this only means a refresh token is stored — a
            revoked token still reads as connected until a link is attempted. */}
        <View style={[s.card, s.statusCard]}>
          <View style={s.statusIcon}>
            <Ionicons name="videocam" size={20} color={COLORS.onPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.statusTitle}>Google Meet</Text>
            <Text style={s.statusSub}>Auto-create meeting links in chat</Text>
          </View>
          <View style={[s.pill, connected && s.pillOn]}>
            <Text style={[s.pillTxt, connected && s.pillTxtOn]}>
              {connected ? 'Connected ✓' : 'Not connected'}
            </Text>
          </View>
        </View>
        {connected && (
          <Text style={s.note}>
            This means a Google account is linked. If meetings start failing, reconnect below — a
            revoked Google token still shows as connected until a link is attempted.
          </Text>
        )}

        <Text style={s.section}>Google credentials</Text>
        <View style={s.card}>
          <Field label="Client ID">
            <TextInput
              style={s.input}
              value={form.clientId}
              onChangeText={(v) => set('clientId', v)}
              placeholder="xxxxx.apps.googleusercontent.com"
              placeholderTextColor={COLORS.faint}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
          <Field label="Client Secret">
            <TextInput
              style={s.input}
              value={form.clientSecret}
              onChangeText={(v) => set('clientSecret', v)}
              placeholder={status?.hasCreds ? '(hidden — leave blank to keep)' : 'Paste the secret from Google'}
              placeholderTextColor={COLORS.faint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
          </Field>
          {/* Read-only and selectable: long-press to copy. Deliberately not
              expo-clipboard — that is a native module and adding one right now
              would need a fresh dev-client build. */}
          <Field label="Redirect URI" hint="paste this into Google — long-press to copy">
            <View style={s.uriBox}>
              <Text style={s.uriTxt} selectable numberOfLines={2}>
                {redirectUri || '—'}
              </Text>
            </View>
          </Field>
          <Field label="Server / base URL" hint="leave blank = auto">
            <TextInput
              style={s.input}
              value={form.baseUrl}
              onChangeText={(v) => set('baseUrl', v)}
              placeholder="https://chat.yourcompany.com"
              placeholderTextColor={COLORS.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </Field>
          <View style={{ height: SPACING.screen }} />
        </View>

        <Text style={s.section}>Behaviour</Text>
        <View style={s.card}>
          <Field label="Trigger words" hint="comma-separated — sending one creates a meeting">
            <TextInput
              style={s.input}
              value={form.triggers}
              onChangeText={(v) => set('triggers', v)}
              placeholder="meet, send link, gmeet"
              placeholderTextColor={COLORS.faint}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
          <Text style={[s.fieldLabel, { paddingHorizontal: SPACING.screen }]}>Where it works</Text>
          {/* ChipRow scrolls horizontally, so it is left unpadded on purpose. */}
          <ChipRow chips={SCOPES} value={form.scope} onChange={(v) => set('scope', v)} />
          <View style={s.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>Admins only</Text>
              <Text style={s.rowSub}>
                When on, only workspace admins and group admins can start a meeting.
              </Text>
            </View>
            <Switch value={!!form.adminOnly} onValueChange={(v) => set('adminOnly', v)} />
          </View>
        </View>

        <View style={{ paddingHorizontal: SPACING.screen }}>
          <TouchableOpacity
            style={[s.primaryBtn, (!dirty || saving) && s.btnOff]}
            disabled={!dirty || saving}
            onPress={save}
            activeOpacity={0.85}
          >
            <Text style={s.primaryTxt}>{saving ? 'Saving…' : 'Save settings'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.connectBtn} onPress={connect} activeOpacity={0.85}>
            <Ionicons name="logo-google" size={18} color={COLORS.primary} />
            <Text style={s.connectTxt}>
              {connected ? 'Reconnect Google account' : 'Connect Google account'}
            </Text>
          </TouchableOpacity>
          <Text style={s.note}>
            This opens your browser. You will be asked to sign in to Odoo first — the browser does
            not share the app's session.
          </Text>
        </View>

        <Accordion
          title="How to set this up (first time)"
          style={{ marginHorizontal: SPACING.screen, marginTop: SPACING.screen }}
        >
          {HELP.map((step, i) => (
            <View key={step} style={s.step}>
              <Text style={s.stepNo}>{i + 1}</Text>
              <Text style={s.stepTxt}>{step}</Text>
            </View>
          ))}
          <View style={s.tip}>
            <Ionicons name="information-circle-outline" size={15} color={COLORS.primary} />
            <Text style={s.tipTxt}>
              Use localhost in the Redirect URI — Google does not allow plain IP addresses.
            </Text>
          </View>
        </Accordion>
      </ScrollView>
    </Screen>
  );
}

function Field({ label, hint, children }) {
  return (
    <View style={{ paddingHorizontal: SPACING.screen }}>
      <Text style={s.fieldLabel}>
        {label}
        {!!hint && <Text style={s.fieldHint}>  {hint}</Text>}
      </Text>
      {children}
    </View>
  );
}

function Head({ onBack }) {
  return (
    <View style={[s.header, { paddingTop: TOP }]}>
      <TouchableOpacity onPress={onBack} style={s.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Ionicons name="chevron-back" size={24} color={COLORS.navy} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>Google Meet</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

const s = themed((C) => ({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: SPACING.md,
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '900', color: C.navy },
  iconBtn: {
    width: 40, height: 40, borderRadius: RADIUS.lg, backgroundColor: COLORS.card,
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },

  section: {
    fontSize: 12.5, fontWeight: '900', color: C.muted, letterSpacing: 0.8,
    paddingHorizontal: SPACING.xl, marginBottom: SPACING.sm, textTransform: 'uppercase',
  },
  card: {
    marginHorizontal: SPACING.screen, marginBottom: SPACING.screen,
    backgroundColor: COLORS.card, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: C.line,
    overflow: 'hidden', ...SHADOW,
  },

  statusCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.screen,
    padding: SPACING.screen, marginTop: SPACING.sm,
  },
  statusIcon: {
    width: 40, height: 40, borderRadius: RADIUS.lg, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  statusTitle: { fontSize: 15.5, fontWeight: '800', color: C.ink },
  statusSub: { fontSize: 12, color: C.slate500, marginTop: 2 },
  pill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.pill,
    backgroundColor: C.slate50, borderWidth: 1, borderColor: C.line,
  },
  pillOn: { backgroundColor: COLORS.greenBg, borderColor: COLORS.greenLine },
  pillTxt: { fontSize: 11.5, fontWeight: '800', color: C.slate500 },
  pillTxtOn: { color: COLORS.emerald },

  // Field already pads horizontally; standalone uses wrap themselves.
  fieldLabel: {
    fontSize: 12.5, fontWeight: '800', color: C.muted,
    marginTop: SPACING.screen, marginBottom: SPACING.xs,
  },
  fieldHint: { fontWeight: '600', color: C.faint, textTransform: 'none' },
  input: {
    backgroundColor: C.slate50, borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.line,
    paddingHorizontal: SPACING.screen, height: 46, fontSize: 15, color: C.ink,
  },
  uriBox: {
    backgroundColor: C.slate50, borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.line,
    paddingHorizontal: SPACING.screen, paddingVertical: 12, minHeight: 46, justifyContent: 'center',
  },
  uriTxt: { fontSize: 13, color: C.ink, fontWeight: '600' },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.screen,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.screen, marginTop: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line,
  },
  rowLabel: { fontSize: 15, color: C.ink, fontWeight: '700' },
  rowSub: { fontSize: 11.5, color: C.slate500, marginTop: 2, lineHeight: 16 },

  primaryBtn: {
    height: 50, borderRadius: RADIUS.lg, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  btnOff: { backgroundColor: C.slate400 },
  primaryTxt: { color: COLORS.onPrimary, fontSize: 15.5, fontWeight: '800' },
  connectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    height: 50, borderRadius: RADIUS.lg, backgroundColor: COLORS.tintBg,
    marginTop: SPACING.sm,
  },
  connectTxt: { color: C.primary, fontSize: 15, fontWeight: '800' },

  note: {
    fontSize: 11.5, color: C.faint, lineHeight: 16,
    paddingHorizontal: SPACING.xs, paddingTop: SPACING.sm, paddingBottom: SPACING.sm,
  },

  step: { flexDirection: 'row', gap: SPACING.md, marginBottom: SPACING.md, alignItems: 'flex-start' },
  stepNo: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.tintBg, overflow: 'hidden',
    textAlign: 'center', lineHeight: 20, fontSize: 11.5, fontWeight: '900', color: C.primary,
  },
  stepTxt: { flex: 1, fontSize: 13, color: C.muted, lineHeight: 19 },
  tip: {
    flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start',
    backgroundColor: COLORS.tintBg, borderRadius: RADIUS.md, padding: SPACING.md, marginTop: SPACING.xs,
  },
  tipTxt: { flex: 1, fontSize: 12, color: C.primary, fontWeight: '600', lineHeight: 17 },
}));
