// CHAT SETTINGS — my profile, notification settings and privacy.
//
// /chat/me is the only READ for all three; /chat/settings and /chat/privacy are
// writers (settings returns nothing but status). So this screen loads once from
// /chat/me and writes through the specific route per field.
//
// Worth knowing while reading the toggles: the notification switches are stored
// but NOT enforced server-side — only mute is. Honouring them is the client's
// job, so they are labelled as affecting this device.
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { COLORS, SHADOW, RADIUS, SPACING, TOP, themed, useTheme, THEME_VARIANTS } from '../theme';
import { Screen, Loader, EmptyState, Avatar, Sheet, PopupModal, Switch } from '../components/ui';
import CameraCaptureModal from '../components/CameraCaptureModal';
import * as chat from '../services/chat';
import { requestOtp, verifyOtp } from '../services/appAuth';
import { saveSession } from '../api/session';
import { createLogger } from '../api/logger';

const log = createLogger('ChatSettings');

const LAST_SEEN = [
  { key: 'everyone', label: 'Everyone' },
  { key: 'contacts', label: 'My contacts' },
  { key: 'nobody', label: 'Nobody' },
];
// The web client's own list, same order (chat_app.js ABOUT_PRESETS).
const ABOUT_PRESETS = [
  'Available', 'Busy', 'At work', 'In a meeting', 'Urgent calls only',
  'At the gym', 'Sleeping', 'Battery about to die', "Can't talk now", 'On holiday',
];

const ONLINE = [
  { key: 'everyone', label: 'Everyone' },
  { key: 'same', label: 'Same as last seen' },
];

export default function ChatSettingsScreen({ user, onBack, onOpenGmeet, onLogout }) {
  // Edge-to-edge draws under the nav bar; reserve that space at the bottom.
  const insets = useSafeAreaInsets();
  const [me, setMe] = useState(null);
  // Google Meet config is admin-only server-side, so the row only appears for
  // admins — the same t-if the web client uses on its Settings entry.
  const [gmeet, setGmeet] = useState(null);
  const { variant: themeVariant, setVariant: setThemeVariant, resetAppearance } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);   // preset list expanded
  const [picker, setPicker] = useState(null);   // 'lastSeen' | 'online'
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [photoOpen, setPhotoOpen] = useState(false);   // avatar source picker
  const [cameraOpen, setCameraOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  // ── Change password (OTP), lifted from the old Profile tab ─────────────────
  // Only offered to app-login users, since it resets the password tied to a
  // mobile number — an Odoo device login has none.
  const mobileDigits = String(user?.mobile || '').replace(/\D/g, '');
  const [pwStep, setPwStep] = useState(null);   // null | 'confirm' | 'otp'
  const [code, setCode] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState('');
  const [resendIn, setResendIn] = useState(0);  // seconds before "Resend" is allowed

  // Cheap and memoised in services/chat, so this costs nothing on a revisit.
  useEffect(() => {
    let alive = true;
    chat.gmeetStatus()
      .then((st) => { if (alive) setGmeet(st); })
      .catch((e) => log.warn('gmeet status failed', e?.message));
    return () => { alive = false; };
  }, []);

  // Tick the resend cooldown down while the OTP popup is open.
  useEffect(() => {
    if (pwStep !== 'otp' || resendIn <= 0) return undefined;
    const id = setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [pwStep, resendIn]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const m = await chat.fetchMe();
      setMe(m); setName(m.name); setAbout(m.about);
    } catch (e) {
      log.warn('load failed', e?.message);
      setError(e?.message || 'Could not load your profile.');
    }
  }, []);

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false); })(); }, [load]);

  // Optimistic switch, reconciled on failure so it can't lie.
  const setSetting = async (key, apiKey, value) => {
    setMe((p) => ({ ...p, [key]: value }));
    try { await chat.saveSettings({ [apiKey]: value }); }
    catch (e) { Alert.alert('Failed', e?.message || 'Please try again.'); load(); }
  };

  const setPrivacy = async (apiKey, value) => {
    setPicker(null);
    const localKey = apiKey === 'last_seen_privacy' ? 'lastSeenPrivacy' : 'onlinePrivacy';
    setMe((p) => ({ ...p, [localKey]: value }));
    try { await chat.savePrivacy({ [apiKey]: value }); }
    catch (e) { Alert.alert('Failed', e?.message || 'Please try again.'); load(); }
  };

  const saveProfile = async () => {
    setEditOpen(false);
    try { await chat.saveProfile({ name: name.trim(), about }); await load(); }
    catch (e) { Alert.alert('Failed', e?.message || 'Could not save.'); }
  };

  // Avatar goes to the SERVER (chat.saveProfile → res.users.image_1920), which is
  // what other people see. The old Profile tab kept a private file on this device
  // instead — nobody else ever saw it, so that pipeline was dropped.
  const uploadAvatar = async (base64) => {
    if (!base64) return;
    try { await chat.saveProfile({ avatar: base64 }); await load(); }
    catch (e) { Alert.alert('Failed', e?.message || 'Could not update the picture.'); }
  };

  const pickFromGallery = async () => {
    setPhotoOpen(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to set a picture.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7, base64: true,
    });
    if (res.canceled || !res.assets?.length) return;
    await uploadAvatar(res.assets[0].base64);
  };

  // CameraCaptureModal hands back a URI and already downscales to ~720px.
  const onCaptured = async (uri) => {
    setCameraOpen(false);
    if (!uri) return;
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      await uploadAvatar(b64);
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Could not read the photo.');
    }
  };

  const sendCode = async () => {
    setPwBusy(true); setPwErr('');
    try {
      await requestOtp(mobileDigits);   // generic — always proceeds
      setResendIn(10);
      setPwStep('otp');
    } catch (e) {
      log.warn('forgot-pw: send code failed', e?.message);
      setPwErr('Could not send the code. Try again.');
    } finally { setPwBusy(false); }
  };

  const submitNewPw = async () => {
    if (code.replace(/\D/g, '').length < 4) { setPwErr('Enter the 4-digit code.'); return; }
    if (newPw.length < 4) { setPwErr('Password must be at least 4 characters.'); return; }
    if (newPw !== newPw2) { setPwErr('Passwords do not match.'); return; }
    setPwBusy(true); setPwErr('');
    try {
      const res = await verifyOtp(mobileDigits, code.replace(/\D/g, ''), newPw);
      if (!res.ok) { setPwErr(res.error || 'Incorrect or expired code.'); setPwBusy(false); return; }
      // The verify re-authenticated the same user, so refresh the stored session
      // and stay logged in.
      await saveSession(res.user);
      setPwStep(null);
      Alert.alert('Password changed', 'Your app password has been updated.');
    } catch (e) {
      log.warn('forgot-pw: verify failed', e?.message);
      setPwErr('Could not verify. Try again.');
    } finally { setPwBusy(false); }
  };

  if (loading) return <Screen><Loader /></Screen>;
  if (error || !me) {
    return (
      <Screen>
        <Head onBack={onBack} />
        <EmptyState icon="alert-circle-outline" tone="error" title={error || 'Unavailable'} onRetry={load} />
      </Screen>
    );
  }

  const labelOf = (list, key) => (list.find((x) => x.key === key) || list[0]).label;

  return (
    <Screen>
      <Head onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <TouchableOpacity onPress={() => setPhotoOpen(true)} activeOpacity={0.85}>
            <Avatar name={me.name} uri={me.avatarUrl} size={104} />
            <View style={s.camera}><Ionicons name="camera" size={15} color={COLORS.onPrimary} /></View>
          </TouchableOpacity>
          <Text style={s.name}>{me.name}</Text>
          <Text style={s.about}>{me.about || 'Available'}</Text>
          {!!me.mobile && <Text style={s.mobile}>{me.mobile}</Text>}
          <TouchableOpacity style={s.editBtn} onPress={() => setEditOpen(true)} activeOpacity={0.85}>
            <Ionicons name="pencil" size={14} color={COLORS.primary} />
            <Text style={s.editTxt}>Edit profile</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.section}>Privacy</Text>
        <View style={s.card}>
          <Item
            icon="eye-outline" label="Last seen" value={labelOf(LAST_SEEN, me.lastSeenPrivacy)}
            onPress={() => setPicker('lastSeen')}
          />
          <Item
            icon="ellipse-outline" label="Online" value={labelOf(ONLINE, me.onlinePrivacy)}
            onPress={() => setPicker('online')}
          />
          <Toggle
            icon="checkmark-done-outline" label="Read receipts"
            sub="When off, you won't send or see blue ticks in 1:1 chats."
            value={me.readReceipts}
            onChange={(v) => setSetting('readReceipts', 'read_receipts', v)}
          />
        </View>

        <Text style={s.section}>Notifications</Text>
        <View style={s.card}>
          <Toggle
            icon="chatbubble-outline" label="Direct messages" value={me.notifMessages}
            onChange={(v) => setSetting('notifMessages', 'notif_messages', v)}
          />
          <Toggle
            icon="people-outline" label="Group messages" value={me.notifGroups}
            onChange={(v) => setSetting('notifGroups', 'notif_groups', v)}
          />
          <Toggle
            icon="volume-high-outline" label="Sound" value={me.notifSound}
            onChange={(v) => setSetting('notifSound', 'notif_sound', v)}
          />
          <Toggle
            icon="eye-off-outline" label="Show message preview" value={me.notifPreview}
            onChange={(v) => setSetting('notifPreview', 'notif_preview', v)}
          />
        </View>
        <Text style={s.note}>
          Notification settings apply to this device. Muting a specific chat is done from that chat.
        </Text>

        {/* Appearance — accent only. The app is light-only by design; there is
            no Display (light/dark/system) choice on either client. */}
        <Text style={s.section}>Appearance</Text>
        <View style={s.card}>
          <Text style={s.subhead}>Accent colour</Text>
          <View style={s.swatchGrid}>
            {THEME_VARIANTS.map((v) => {
              const on = themeVariant === v.id;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={s.swatchCell}
                  onPress={() => setThemeVariant(v.id)}
                  activeOpacity={0.8}
                >
                  {/* Two-tone chip = brand + accent, the same swatch the web
                      picker draws as a 135° gradient. */}
                  <View style={[s.swatch, on && s.swatchOn]}>
                    <View style={[s.swatchHalf, { backgroundColor: v.swatch[0] }]} />
                    <View style={[s.swatchHalf, { backgroundColor: v.swatch[1] }]} />
                    {on && (
                      <View style={s.swatchCheck}>
                        <Ionicons name="checkmark" size={15} color={COLORS.onPrimary} />
                      </View>
                    )}
                  </View>
                  <Text style={[s.swatchTxt, on && s.swatchTxtOn]} numberOfLines={1}>{v.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={s.resetBtn} onPress={resetAppearance} activeOpacity={0.7}>
            <Ionicons name="refresh" size={15} color={COLORS.primary} />
            <Text style={s.resetTxt}>Reset to default</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.note}>Your theme is saved on this device.</Text>

        {/* Connection details — the only place the Odoo server/db/uid surface.
            Came from the old Profile tab. */}
        <Text style={s.section}>Connection</Text>
        <View style={s.card}>
          <Detail label="Username" value={user?.username || user?.login || '—'} />
          {!!user?.mobile && <Detail label="Mobile" value={user.mobile} />}
          <Detail label="Database" value={user?.db || '—'} />
          <Detail label="Server" value={user?.serverUrl || '—'} />
          <Detail label="User ID" value={user?.uid != null ? String(user.uid) : '—'} />
        </View>

        {/* Workspace-wide Google Meet setup — same panel the web client has. */}
        {!!gmeet?.isAdmin && (
          <>
            <Text style={s.section}>Workspace</Text>
            <View style={s.card}>
              <Item
                icon="videocam-outline"
                label="Google Meet"
                value={gmeet.connected ? 'Connected' : 'Not connected — tap to set up'}
                onPress={onOpenGmeet}
              />
            </View>
          </>
        )}

        <Text style={s.section}>Account</Text>
        <View style={s.card}>
          {/* Password reset is OTP-to-mobile, so it only applies to app logins. */}
          {!!mobileDigits && (
            <TouchableOpacity
              style={s.row}
              activeOpacity={0.7}
              onPress={() => { setPwErr(''); setCode(''); setNewPw(''); setNewPw2(''); setResendIn(0); setPwStep('confirm'); }}
            >
              <Ionicons name="key-outline" size={20} color={COLORS.primary} />
              <Text style={[s.rowLabel, { flex: 1 }]}>Change password</Text>
              <Ionicons name="chevron-forward" size={17} color={COLORS.faint} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={() => setLogoutOpen(true)}>
            <Ionicons name="log-out-outline" size={20} color={COLORS.red} />
            <Text style={[s.rowLabel, { flex: 1, color: COLORS.red }]}>Log out</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.footer}>Alphalize 369Chats · v1.0</Text>
      </ScrollView>

      {/* Centred, not a bottom sheet: it is a short form the user is answering,
          and the keyboard pushing a bottom sheet around left the Save button
          half off-screen. */}
      <PopupModal visible={editOpen} onClose={() => setEditOpen(false)} title="Edit profile">
        <View style={s.dialogBody}>
          <Text style={s.fieldLabel}>Name</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={COLORS.faint} />
          <Text style={s.fieldLabel}>About</Text>
          <TextInput
            style={s.input} value={about} onChangeText={setAbout} maxLength={139}
            placeholder="Available" placeholderTextColor={COLORS.faint}
          />
          {/* The same ten presets the web client offers, in the same order.
              Still free-text above — the presets are a shortcut, not a limit. */}
          <TouchableOpacity
            style={s.aboutToggle}
            onPress={() => setAboutOpen((v) => !v)}
            activeOpacity={0.7}
          >
            <Text style={s.aboutToggleTxt}>Choose a status</Text>
            <Ionicons
              name={aboutOpen ? 'chevron-up' : 'chevron-down'}
              size={16} color={COLORS.primary}
            />
          </TouchableOpacity>
          {aboutOpen && (
            <View style={s.aboutList}>
              {ABOUT_PRESETS.map((p) => {
                const on = about.trim() === p;
                return (
                  <TouchableOpacity
                    key={p}
                    style={s.aboutOpt}
                    onPress={() => { setAbout(p); setAboutOpen(false); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.aboutOptTxt, on && s.aboutOptTxtOn]}>{p}</Text>
                    {on && <Ionicons name="checkmark" size={16} color={COLORS.primary} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          <TouchableOpacity
            style={[s.primaryBtn, !name.trim() && { backgroundColor: COLORS.slate400 }]}
            disabled={!name.trim()} onPress={saveProfile}
          >
            <Text style={s.primaryTxt}>Save</Text>
          </TouchableOpacity>
        </View>
      </PopupModal>

      <PopupModal
        visible={!!picker}
        onClose={() => setPicker(null)}
        title={picker === 'online' ? 'Who can see when I am online' : 'Who can see my last seen'}
      >
        {(picker === 'online' ? ONLINE : LAST_SEEN).map((o) => {
          const current = picker === 'online' ? me.onlinePrivacy : me.lastSeenPrivacy;
          return (
            <TouchableOpacity
              key={o.key} style={s.pick} activeOpacity={0.8}
              onPress={() => setPrivacy(picker === 'online' ? 'online_privacy' : 'last_seen_privacy', o.key)}
            >
              <Text style={s.pickTxt}>{o.label}</Text>
              {current === o.key && <Ionicons name="checkmark" size={19} color={COLORS.primary} />}
            </TouchableOpacity>
          );
        })}
        {picker === 'lastSeen' && (
          <Text style={s.pickNote}>
            If you choose Nobody, you won't be able to see anyone else's last seen either.
          </Text>
        )}
      </PopupModal>

      {/* Avatar source */}
      <Sheet visible={photoOpen} onClose={() => setPhotoOpen(false)} title="Profile photo">
        <TouchableOpacity style={s.srcRow} activeOpacity={0.7} onPress={() => { setPhotoOpen(false); setCameraOpen(true); }}>
          <Ionicons name="camera-outline" size={21} color={COLORS.primary} />
          <Text style={s.srcTxt}>Take a photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.srcRow} activeOpacity={0.7} onPress={pickFromGallery}>
          <Ionicons name="images-outline" size={21} color={COLORS.primary} />
          <Text style={s.srcTxt}>Choose from gallery</Text>
        </TouchableOpacity>
        <Text style={s.srcNote}>Your photo is visible to everyone you chat with.</Text>
      </Sheet>

      <CameraCaptureModal visible={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={onCaptured} />

      {/* Change password, step 1 — confirm the number the code goes to */}
      <PopupModal visible={pwStep === 'confirm'} onClose={() => setPwStep(null)} title="Change password">
        <View style={{ padding: SPACING.xl }}>
          <Text style={s.pwBody}>
            We'll send a 4-digit code to{' '}
            <Text style={{ fontWeight: '900', color: COLORS.navy }}>{user?.mobile}</Text>.
          </Text>
          {!!pwErr && <Text style={s.pwErr}>{pwErr}</Text>}
          <TouchableOpacity
            style={[s.primaryBtn, pwBusy && { backgroundColor: COLORS.slate400 }]}
            disabled={pwBusy} onPress={sendCode}
          >
            {pwBusy ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={s.primaryTxt}>Send code</Text>}
          </TouchableOpacity>
        </View>
      </PopupModal>

      {/* Change password, step 2 — code + new password */}
      <PopupModal visible={pwStep === 'otp'} onClose={() => setPwStep(null)} title="Enter code">
        <ScrollView style={{ maxHeight: 380 }}>
          <View style={{ padding: SPACING.xl }}>
            <Text style={s.pwBody}>
              Enter the code sent to{' '}
              <Text style={{ fontWeight: '800', color: COLORS.navy }}>{user?.mobile}</Text> and choose a new password.
            </Text>
            <TextInput
              style={s.input} value={code} onChangeText={setCode} keyboardType="number-pad"
              maxLength={4} placeholder="4-digit code" placeholderTextColor={COLORS.faint}
            />
            <View style={s.pwRow}>
              <TextInput
                style={[s.input, { flex: 1, marginBottom: 0 }]} value={newPw} onChangeText={setNewPw}
                secureTextEntry={!showPw} placeholder="New password" placeholderTextColor={COLORS.faint}
              />
              <TouchableOpacity onPress={() => setShowPw((v) => !v)} style={s.eye} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={COLORS.muted} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={s.input} value={newPw2} onChangeText={setNewPw2} secureTextEntry={!showPw}
              placeholder="Re-enter new password" placeholderTextColor={COLORS.faint}
            />
            {!!pwErr && <Text style={s.pwErr}>{pwErr}</Text>}
            <TouchableOpacity
              style={[s.primaryBtn, pwBusy && { backgroundColor: COLORS.slate400 }]}
              disabled={pwBusy} onPress={submitNewPw}
            >
              {pwBusy ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={s.primaryTxt}>Verify & set password</Text>}
            </TouchableOpacity>
            <TouchableOpacity disabled={resendIn > 0 || pwBusy} onPress={sendCode} style={{ marginTop: SPACING.md }}>
              <Text style={[s.resend, (resendIn > 0 || pwBusy) && { color: COLORS.faint }]}>
                {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </PopupModal>

      {/* Log out confirm */}
      <PopupModal visible={logoutOpen} onClose={() => setLogoutOpen(false)} title="Log out?">
        <View style={{ padding: SPACING.xl }}>
          <Text style={s.pwBody}>You'll need to sign in again with your username and password.</Text>
          <TouchableOpacity
            style={[s.primaryBtn, { backgroundColor: COLORS.red }]}
            onPress={() => { setLogoutOpen(false); onLogout?.(); }}
          >
            <Text style={s.primaryTxt}>Log out</Text>
          </TouchableOpacity>
        </View>
      </PopupModal>
    </Screen>
  );
}

// A read-only label/value line for the Connection card.
function Detail({ label, value }) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.detailLabel}>{label}</Text>
        <Text style={s.detailValue} numberOfLines={2}>{value}</Text>
      </View>
    </View>
  );
}

function Head({ onBack }) {
  return (
    <View style={[s.header, { paddingTop: TOP }]}>
      <TouchableOpacity onPress={onBack} style={s.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Ionicons name="chevron-back" size={24} color={COLORS.navy} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>Chat settings</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

function Item({ icon, label, value, onPress }) {
  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={20} color={COLORS.primary} />
      <View style={{ flex: 1 }}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.rowValue}>{value}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={COLORS.faint} />
    </TouchableOpacity>
  );
}

function Toggle({ icon, label, sub, value, onChange }) {
  return (
    <View style={s.row}>
      <Ionicons name={icon} size={20} color={COLORS.primary} />
      <View style={{ flex: 1 }}>
        <Text style={s.rowLabel}>{label}</Text>
        {!!sub && <Text style={s.rowSub}>{sub}</Text>}
      </View>
      <Switch value={!!value} onValueChange={onChange} />
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

  hero: { alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.xs },
  camera: {
    position: 'absolute', right: 0, bottom: 0,
    width: 30, height: 30, borderRadius: 15, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COLORS.card,
  },
  name: { fontSize: 21, fontWeight: '900', color: C.navy, marginTop: SPACING.sm },
  about: { fontSize: 13.5, color: C.slate500 },
  mobile: { fontSize: 13, color: C.faint },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: SPACING.sm,
    backgroundColor: COLORS.tintBg, borderRadius: RADIUS.pill, paddingHorizontal: 14, paddingVertical: 7,
  },
  editTxt: { fontSize: 13, fontWeight: '800', color: C.primary },

  section: {
    fontSize: 12.5, fontWeight: '900', color: C.muted, letterSpacing: 0.8,
    paddingHorizontal: SPACING.xl, marginBottom: SPACING.sm, textTransform: 'uppercase',
  },
  card: {
    marginHorizontal: SPACING.screen, marginBottom: SPACING.screen,
    backgroundColor: COLORS.card, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: C.line,
    overflow: 'hidden', ...SHADOW,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.screen,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.screen,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  rowLabel: { fontSize: 15, color: C.ink, fontWeight: '700' },
  rowValue: { fontSize: 12.5, color: C.slate500, marginTop: 2 },
  rowSub: { fontSize: 11.5, color: C.slate500, marginTop: 2, lineHeight: 16 },
  note: { fontSize: 11.5, color: C.faint, paddingHorizontal: SPACING.xl, lineHeight: 16 },

  fieldLabel: { fontSize: 12.5, fontWeight: '800', color: C.muted, marginTop: SPACING.md, marginBottom: SPACING.xs },
  input: {
    backgroundColor: C.slate50, borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.line,
    paddingHorizontal: SPACING.screen, height: 46, fontSize: 15, color: C.ink,
  },
  primaryBtn: {
    height: 50, borderRadius: RADIUS.lg, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: SPACING.screen, marginBottom: SPACING.sm,
  },
  primaryTxt: { color: COLORS.onPrimary, fontSize: 15.5, fontWeight: '800' },

  pick: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl, paddingVertical: SPACING.screen,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  pickTxt: { fontSize: 15, color: C.ink, fontWeight: '600' },
  pickNote: { fontSize: 11.5, color: C.faint, padding: SPACING.xl, lineHeight: 16 },

  subhead: {
    fontSize: 11.5, fontWeight: '800', color: C.faint, letterSpacing: 0.5,
    paddingHorizontal: SPACING.screen, paddingTop: SPACING.screen, textTransform: 'uppercase',
  },
  // PopupModal has no padding of its own — a centred dialog's content needs it.
  aboutToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: SPACING.md,
  },
  aboutToggleTxt: { fontSize: 13.5, fontWeight: '800', color: C.primary },
  aboutList: {
    borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.md,
    backgroundColor: C.slate50, overflow: 'hidden', marginBottom: SPACING.sm,
  },
  aboutOpt: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  aboutOptTxt: { fontSize: 14.5, color: C.ink },
  aboutOptTxtOn: { color: C.primary, fontWeight: '800' },
  dialogBody: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.lg },
  // 4 across on a narrow phone, so seven variants land as 4 + 3.
  swatchGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.xs,
  },
  swatchCell: { width: '25%', alignItems: 'center', gap: 5, marginBottom: SPACING.screen },
  swatch: {
    width: 44, height: 44, borderRadius: 22, flexDirection: 'row', overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  swatchOn: { borderColor: C.primary },
  // Two flex halves fill the chip; the tick floats over the join.
  swatchHalf: { flex: 1, alignSelf: 'stretch' },
  swatchCheck: {
    position: 'absolute',
    width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  swatchTxt: { fontSize: 11, fontWeight: '700', color: C.slate500 },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: SPACING.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line,
  },
  resetTxt: { fontSize: 13.5, fontWeight: '800', color: C.primary },
  swatchTxtOn: { color: C.primary, fontWeight: '800' },

  detailLabel: { fontSize: 11.5, color: C.slate500, fontWeight: '700' },
  detailValue: { fontSize: 14, color: C.ink, fontWeight: '600', marginTop: 2 },
  footer: {
    fontSize: 11.5, color: C.faint, textAlign: 'center',
    marginTop: SPACING.md, marginBottom: SPACING.xl,
  },

  srcRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingVertical: SPACING.screen, paddingHorizontal: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  srcTxt: { fontSize: 15.5, fontWeight: '700', color: C.ink },
  srcNote: { fontSize: 11.5, color: C.faint, paddingTop: SPACING.md, paddingBottom: SPACING.sm },

  pwBody: { fontSize: 14, color: C.muted, lineHeight: 20, marginBottom: SPACING.screen },
  pwErr: { fontSize: 12.5, color: C.red, fontWeight: '700', marginBottom: SPACING.sm },
  pwRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm },
  eye: { position: 'absolute', right: SPACING.lg },
  resend: { fontSize: 13, color: C.primary, fontWeight: '800', textAlign: 'center' },
}));
