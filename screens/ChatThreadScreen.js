// CHAT THREAD — one conversation: history, live incoming, send, receipts.
//
// The list is INVERTED. Messages are held newest-first in state and FlatList
// draws bottom-up, which is what makes "stick to the latest message" free and
// makes loading older pages append rather than prepend (no scroll jumping).
// The server returns ascending by id, so every fetch is reversed on the way in.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Platform, ActivityIndicator, Alert, Linking, TextInput, ScrollView, Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { COLORS, SHADOW, RADIUS, SPACING, TOP, themed } from '../theme';
import { Screen, Loader, EmptyState, Avatar, Sheet, MenuPopup, PopupModal, ConfirmDialog } from '../components/ui';
import MessageBubble from '../components/chat/MessageBubble';
import Composer from '../components/chat/Composer';
import MediaViewer from '../components/chat/MediaViewer';
import MediaPreview from '../components/chat/MediaPreview';
import AttachSheet from '../components/chat/AttachSheet';
import VoiceRecorder from '../components/chat/VoiceRecorder';
import MuteSheet from '../components/chat/MuteSheet';
import CameraCaptureModal from '../components/CameraCaptureModal';
import * as chat from '../services/chat';
import realtime from '../services/chatRealtime';
import usePlaceCall from '../hooks/usePlaceCall';
import useBackIntercept from '../hooks/useBackIntercept';
import { draftFor, setDraft, clearDraft } from '../services/drafts';
import { copyText } from '../utils/clipboard';
import useKeyboardHeight from '../utils/useKeyboardHeight';
import openAttachment from '../utils/openAttachment';
import presenceText from '../utils/presence';
import { createLogger } from '../api/logger';

const log = createLogger('ChatThread');

const PAGE = 50;

function timeOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function dayKey(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toDateString();
}

function dayLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}

function humanSize(bytes) {
  if (!bytes) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

// How long a pin has left. Kept behaviour-identical to pinLeft() in the web
// client (chat_app.js) — pins always carry an expiry, and without this the pin
// simply vanished one day with no warning.
function pinLeft(iso) {
  if (!iso) return '';
  const exp = new Date(iso);
  if (Number.isNaN(exp.getTime())) return '';
  const ms = exp.getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days >= 1) return `${days} ${days === 1 ? 'day' : 'days'} left`;
  if (hours >= 1) return `${hours} ${hours === 1 ? 'hour' : 'hours'} left`;
  return `${Math.max(1, Math.floor(ms / 60000))} min left`;
}

// Server message → what MessageBubble expects. One place, so bubble stays dumb.
function toBubble(m) {
  return {
    id: m.id,
    body: m.body,
    mine: m.mine,
    authorName: m.authorName,
    time: timeOf(m.created),
    status: m.status,
    kind: m.kind === 'document' ? 'file' : m.kind,
    mediaUri: m.mediaUrl,
    fileName: m.fileName,
    fileSize: humanSize(m.fileSize),
    replyTo: m.quoted ? { authorName: m.replyToAuthor, preview: m.replyToBody } : null,
    edited: m.edited,
    deleted: m.deleted,
    starred: m.starred,
    forwarded: m.forwarded,
    isMeet: m.isMeet,
    // Call card. These MUST be copied through: this mapper is what MessageBubble
    // actually receives, so a field missing here reads as undefined in the bubble
    // — which sent call messages down the centred system-line path and made the
    // cards silently not render in the app while the web (which uses the raw
    // message) was fine.
    isCall: m.isCall,
    callVideo: m.callVideo,
    callMissed: m.callMissed,
    duration: m.duration,
    // Same trap, two more fields that were silently lost here: `pinned` drives
    // the per-bubble pin glyph, and `mimetype` is what tells an image from a
    // video (without it AuthImage caches every attachment as .jpeg).
    pinned: m.pinned,
    mimetype: m.mimetype,
    // View-once: the server withholds media_url once it has been opened (and
    // always for the author), so `hasMedia` is what says whether it can still be
    // viewed — not `viewOnce` on its own.
    viewOnce: m.viewOnce,
    canViewOnce: m.viewOnce && m.hasMedia,
    reactions: m.reactions,
    poll: m.poll,
    link: m.link,
    // AudioBubble plays the real attachment, so it needs the untouched message
    // (mediaUrl, mimetype, duration) rather than this display-shaped copy.
    raw: m,
  };
}

// The quick-reaction row. Matches the set the module's web client offers.
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

// The full set behind the + on that row.
const ALL_REACTIONS = [
  '👍', '👎', '❤️', '🔥', '🎉', '👏', '🙏', '💯',
  '😂', '🤣', '😅', '😊', '😍', '😎', '🤔', '😐',
  '😮', '😢', '😭', '😡', '🥳', '🤝', '💪', '✅',
  '❌', '⚠️', '👀', '🚀', '⭐', '💡', '⏰', '📌',
];

const HIT = { top: 12, bottom: 12, left: 8, right: 8 };

// /chat/pin_message accepts only these four; anything else is rejected.
const PIN_DAYS = [
  { days: 1, label: '24 hours' },
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
];

export default function ChatThreadScreen({
  conversation, onBack, onOpenInfo, onOpenSearch, onOpenMedia, onOpenStarred,
  // Admin-only Google Meet setup — offered from the ⋮ when Meet isn't connected.
  onOpenGmeet,
  // Reply privately: hand the 1:1 + the quote back up so App can switch chats.
  onReplyPrivately, initialQuote,
  // Message id to open at and flash — set when arriving from a search hit.
  focusMessageId,
}) {
  const convId = conversation?.id;
  const [messages, setMessages] = useState([]);   // newest-first (inverted list)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);   // no older pages left
  const [replyTo, setReplyTo] = useState(null);
  // Arriving from another chat's 'Reply privately' — seed the composer's quote.
  useEffect(() => { if (initialQuote) setReplyTo({ external: true, ...initialQuote }); }, [initialQuote]);
  const [typingName, setTypingName] = useState(null);
  const [viewerMsg, setViewerMsg] = useState(null);   // media open full-screen
  const [menuOpen, setMenuOpen] = useState(false);    // header ⋮ menu
  // Long-press selects a message: the header turns into a contextual action bar
  // and a reaction strip floats above the bubble, the way WhatsApp does it.
  const [selected, setSelected] = useState(null);
  const [selMenu, setSelMenu] = useState(false);      // the ⋮ inside that bar
  const [confirmDel, setConfirmDel] = useState(null); // message awaiting delete confirmation
  const [confirmClear, setConfirmClear] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);   // media upload progress
  const [msgInfo, setMsgInfo] = useState(null);   // { message, loading?, isGroup, read[], delivered[] }
  const [emojiPick, setEmojiPick] = useState(null);   // full emoji list for a reaction
  // In-thread search: the header becomes a field and the list shows only hits.
  const [searchMode, setSearchMode] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchIdx, setSearchIdx] = useState(0);   // which hit the stepper is on
  const searchTimer = useRef(null);
  const [editing, setEditing] = useState(null);       // message being edited
  const [forwarding, setForwarding] = useState(null); // message being forwarded
  const [pinned, setPinned] = useState([]);           // pinned banner
  const [pinsOpen, setPinsOpen] = useState(false);    // the pinned-messages list
  const [pollOpen, setPollOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [opening, setOpening] = useState(null);   // message id being fetched to open
  const [highlightId, setHighlightId] = useState(null);  // search hit to flash
  const [previewItems, setPreviewItems] = useState(null);  // review tray contents
  const [pinAsk, setPinAsk] = useState(null);              // message awaiting a pin duration
  const [muteAsk, setMuteAsk] = useState(false);           // mute duration picker
  const [atBottom, setAtBottom] = useState(true); // drives the jump-to-latest arrow
  const listRef = useRef(null);

  const typingTimer = useRef(null);
  const seenIds = useRef(new Set());   // realtime can re-deliver; ids must not duplicate
  const kb = useKeyboardHeight();      // lifts the thread + composer above the keyboard
  const insets = useSafeAreaInsets();  // and above the nav bar when it is down
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Remember the keyboard's height so the emoji panel opens at exactly the same
  // size — swapping between them then doesn't shunt the message list up or down.
  const lastKb = useRef(280);
  useEffect(() => { if (kb > 0) lastKb.current = kb; }, [kb]);

  const isGroup = !!conversation?.isGroup;

  // ── placing a call ─────────────────────────────────────────────────────────
  // Shared with ContactInfoScreen and CallsScreen — see hooks/usePlaceCall for
  // the gate and the re-entry guard, both of which exist for reasons that are
  // not obvious from the call site.
  const { placeCall, callErr, clearCallErr } = usePlaceCall(conversation);

  // Whether to SHOW the buttons, which is a weaker test than whether a call can
  // succeed. A missing native module is a property of the build, not of this
  // chat, so it hides nothing here — see the header for why.
  const showCall = !isGroup && !conversation?.oversight && !conversation?.blockedByMe;

  // ── initial load ───────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setError(null);
    try {
      // Arriving from a search hit: load the WINDOW AROUND that message (30
      // before + 30 after) instead of the newest page, so the match is actually
      // on screen. /chat/messages_around exists precisely for this.
      if (focusMessageId) {
        const around = await chat.fetchMessagesAround(convId, focusMessageId);
        if (around.length) {
          seenIds.current = new Set(around.map((m) => m.id));
          setMessages(around.slice().reverse());
          // Not the newest page, so more may exist below — don't claim exhausted.
          setExhausted(false);
          realtime.setActiveConversation(convId, around[around.length - 1].id);
          setHighlightId(focusMessageId);
          return;
        }
      }
      const asc = await chat.fetchMessages(convId, { limit: PAGE });
      seenIds.current = new Set(asc.map((m) => m.id));
      setMessages(asc.slice().reverse());
      setExhausted(asc.length < PAGE);
      const newest = asc.length ? asc[asc.length - 1].id : 0;
      realtime.setActiveConversation(convId, newest);
      if (newest) chat.markRead(convId, newest).catch(() => {});
    } catch (e) {
      log.warn('load failed', e?.message);
      setError(e?.message || 'Could not load this chat.');
    }
  }, [convId, focusMessageId]);

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false); })(); }, [load]);

  // Scroll the focused message into view once the list has it, then fade the
  // highlight. scrollToIndex needs the row to exist, hence the effect rather
  // than doing it inside load().
  useEffect(() => {
    if (!highlightId || !messages.length) return undefined;
    const idx = messages.findIndex((m) => m.id === highlightId);
    if (idx < 0) return undefined;
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
      } catch (_) { /* row not measured yet — the highlight still shows */ }
    }, 120);
    // Long enough to notice after the scroll settles.
    const clear = setTimeout(() => setHighlightId(null), 2600);
    return () => { clearTimeout(t); clearTimeout(clear); };
  }, [highlightId, messages]);

  // Release the thread cursor on unmount so the engine stops polling it.
  useEffect(() => () => {
    realtime.setActiveConversation(null);
    clearTimeout(typingTimer.current);
  }, []);

  // ── realtime ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const off = realtime.subscribe((event, data) => {
      if (data.conversationId !== convId) return;

      if (event === 'message') {
        const m = data.message;
        if (seenIds.current.has(m.id)) return;   // already have it (e.g. our own send)
        seenIds.current.add(m.id);
        setMessages((prev) => [m, ...prev]);
        // Reading it as it arrives is what keeps the other side's ticks honest.
        chat.markRead(convId, m.id).catch(() => {});
      }

      if (event === 'update') {
        const m = data.message;
        setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
      }

      if (event === 'typing') {
        // No server-side expiry — the receiver times it out.
        setTypingName(data.typing ? data.name : null);
        clearTimeout(typingTimer.current);
        if (data.typing) typingTimer.current = setTimeout(() => setTypingName(null), 4000);
      }
    });
    return off;
  }, [convId]);

  // ── older pages ────────────────────────────────────────────────────────────
  const loadOlder = useCallback(async () => {
    if (loadingMore || exhausted || !messages.length) return;
    setLoadingMore(true);
    try {
      // messages[last] is the OLDEST held (list is newest-first).
      const oldest = messages[messages.length - 1].id;
      const asc = await chat.fetchMessages(convId, { beforeId: oldest, limit: PAGE });
      asc.forEach((m) => seenIds.current.add(m.id));
      // Inverted list → older messages append to the END.
      setMessages((prev) => [...prev, ...asc.slice().reverse()]);
      setExhausted(asc.length < PAGE);
    } catch (e) {
      log.warn('older page failed', e?.message);
    } finally {
      setLoadingMore(false);
    }
  }, [convId, messages, loadingMore, exhausted]);

  // ── google meet ────────────────────────────────────────────────────────────
  // Read once per thread (memoised in services/chat) so the ⋮ and the 📎 sheet
  // can say what is actually possible, instead of only explaining themselves in
  // an alert after the tap.
  const [gmeet, setGmeet] = useState(null);
  useEffect(() => {
    let alive = true;
    chat.gmeetStatus()
      .then((st) => { if (alive) setGmeet(st); })
      .catch((e) => log.warn('gmeet status failed', e?.message));
    return () => { alive = false; };
  }, []);

  // Scope depends only on global config plus isGroup, both known here.
  // admin_only deliberately is NOT checked client-side: /chat/gmeet/status
  // reports is_admin for the WORKSPACE, while the server also lets a GROUP admin
  // start one — so refusing here would block something the server would allow.
  // Let the server say no; its message reaches the user through the catch.
  const meetScopeOk = !gmeet
    || (gmeet.scope !== 'groups' && gmeet.scope !== 'direct')
    || (gmeet.scope === 'groups' ? isGroup : !isGroup);
  const canMeet = !!gmeet?.connected && meetScopeOk;

  const startMeet = useCallback(async () => {
    try {
      const st = await chat.gmeetStatus();
      if (!st.connected) {
        // An admin can fix this, so take them straight to the setup panel.
        if (st.isAdmin) { onOpenGmeet?.(); return; }
        Alert.alert(
          'Google Meet not connected',
          'An administrator needs to connect the shared Google account in Odoo before meetings can be created.',
        );
        return;
      }
      if (st.scope === 'groups' && !isGroup) {
        Alert.alert('Not allowed', 'Meetings are limited to group chats here.');
        return;
      }
      if (st.scope === 'direct' && isGroup) {
        Alert.alert('Not allowed', 'Meetings are limited to direct chats here.');
        return;
      }
      const m = await chat.createMeet(convId);
      seenIds.current.add(m.id);
      realtime.noteMessageId(m.id);
      setMessages((prev) => [m, ...prev]);
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Please try again.');
    }
  }, [convId, isGroup, onOpenGmeet]);

  // ── send ───────────────────────────────────────────────────────────────────
  const send = useCallback(async (body, linkCard) => {
    // Trigger words. The web client turns a bare "meet" into a meeting rather
    // than a message (chat_app.js _meetTriggered); the app fetched `triggers`
    // and ignored them, so the same workspace behaved differently per client.
    const trigger = (body || '').trim().toLowerCase();
    if (gmeet?.connected && (gmeet.triggers || []).includes(trigger)) {
      setReplyTo(null);
      await startMeet();
      return;
    }
    setSending(true);
    const reply = replyTo;
    setReplyTo(null);

    // Optimistic bubble. The app used to await the round trip before drawing
    // anything, which made every message feel slower than the web client. The
    // temp id is a string so it can never collide with a server id, and it is
    // swapped for the real message (or rolled back) below.
    clearDraft(convId);
    const tempId = `tmp-${Date.now()}`;
    setMessages((prev) => [{
      id: tempId, body, mine: true, kind: 'text', status: 'sending',
      created: new Date().toISOString(), reactions: [], pending: true,
      quoted: !!reply,
      replyToAuthor: reply?.authorName, replyToBody: reply?.body,
      link: linkCard || null,
    }, ...prev]);

    try {
      const msg = await chat.sendText(convId, body, reply?.external
        ? { quoteAuthor: reply.authorName, quoteBody: reply.body }
        : { replyToId: reply?.id });
      seenIds.current.add(msg.id);
      realtime.noteMessageId(msg.id);
      // The server always returns link:null here — it scrapes in a background
      // thread after responding. Carry the composer's card over so the preview
      // is there the instant the bubble appears; the periodic refetch later
      // replaces it with the server's own copy.
      setMessages((prev) => prev.map((x) => (
        x.id === tempId ? { ...msg, link: msg.link || linkCard || null } : x
      )));
    } catch (e) {
      // Roll the bubble back and hand the text and the quote back to the user —
      // losing what they typed on a failed send is worse than the failure.
      setMessages((prev) => prev.filter((x) => x.id !== tempId));
      if (reply) setReplyTo(reply);
      // The server refuses sends for real reasons (blocked, admin-only group), so
      // surface the message rather than silently dropping the text.
      Alert.alert('Not sent', e?.message || 'Could not send the message.');
    } finally {
      setSending(false);
    }
  }, [convId, replyTo, gmeet, startMeet]);

  const typing = useCallback((on) => { chat.sendTyping(convId, on); }, [convId]);

  // ── attachments ────────────────────────────────────────────────────────────
  const pushMedia = useCallback(async (opts) => {
    setSending(true);
    setUploadPct(0);
    // Every media path funnels through here, so this is the one place the reply
    // has to be attached. sendMedia has always taken replyToId and nothing ever
    // passed it: replying to a message and then attaching a photo dropped the
    // reply silently — the send succeeded, just unquoted.
    const reply = replyTo;
    setReplyTo(null);
    try {
      // sendMedia has always accepted an onProgress callback; nothing ever
      // passed one, so a large upload looked identical to a hung app.
      const msg = await chat.sendMedia(
        convId,
        { ...opts, replyToId: reply?.id },
        (pct) => setUploadPct(pct),
      );
      seenIds.current.add(msg.id);
      realtime.noteMessageId(msg.id);
      setMessages((prev) => [msg, ...prev]);
    } catch (e) {
      Alert.alert('Not sent', e?.message || 'Could not send the attachment.');
      // Give the reply back so the user is not silently dropped out of context.
      if (reply) setReplyTo(reply);
    } finally {
      setUploadPct(0);
      setSending(false);
    }
  }, [convId, replyTo]);

  // Gallery — multi-select. Nothing is uploaded here: the picks go to the review
  // tray, where captions, crop, quality and view-once are decided before sending.
  // No `base64: true` either — the tray re-encodes from the original anyway, and
  // asking for base64 on ten items would load them all into memory for nothing.
  const pickGallery = useCallback(async (mediaTypes) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to send media.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes, allowsMultipleSelection: true, selectionLimit: 10, quality: 1,
    });
    if (res.canceled || !res.assets?.length) return;
    setPreviewItems(res.assets.map((a) => ({
      uri: a.uri,
      filename: a.fileName || undefined,
      mimetype: a.mimeType,
      isVideo: a.type === 'video' || /video/i.test(a.mimeType || ''),
      duration: a.duration ? Math.round(a.duration / 1000) : 0,
      width: a.width,
      height: a.height,
    })));
  }, []);

  // Thumbnails chosen in the attach sheet's Recent strip land in the same tray.
  const sendGalleryAsset = useCallback((assets) => {
    const many = Array.isArray(assets) ? assets : [assets];
    setPreviewItems(many.map((a) => ({
      uri: a.uri, filename: a.filename, isVideo: a.isVideo,
      duration: a.duration || 0, width: a.width, height: a.height,
    })));
  }, []);

  // Documents skip the tray — there is nothing to crop or caption — but they do
  // support multi-select now.
  const pickDocument = useCallback(async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
    if (res.canceled || !res.assets?.length) return;
    for (const f of res.assets) {
      // DocumentPicker hands back a uri, not bytes — read it as base64 ourselves.
      const b64 = await FileSystem.readAsStringAsync(f.uri, { encoding: 'base64' });
      await pushMedia({
        kind: 'document', fileB64: b64,
        fileName: f.name || 'file', mimetype: f.mimeType || 'application/octet-stream',
      });
    }
  }, [pushMedia]);

  // Everything the review tray produced, sent in order so captions stay attached
  // to the right photo.
  const sendReviewed = useCallback(async (payload) => {
    setPreviewItems(null);
    for (const p of payload) {
      await pushMedia({
        kind: p.kind, fileB64: p.fileB64, fileName: p.fileName,
        mimetype: p.mimetype, caption: p.caption, duration: p.duration,
        viewOnce: p.viewOnce,
      });
    }
  }, [pushMedia]);

  // In-app camera (the existing CameraCaptureModal) rather than the system one:
  // capture stays inside the app and it already downscales to ~720px, which
  // matters here because the upload is base64 in a JSON body.
  //
  // It calls onCapture with a plain URI string — no base64.
  //
  // A capture goes into the SAME review tray as a gallery pick. It used to
  // upload immediately, which meant no preview, no caption, no crop and no
  // view-once for anything shot with the camera — and no way to back out of a
  // bad photo.
  const onCaptured = useCallback((uri) => {
    setCameraOpen(false);
    if (!uri) return;
    setPreviewItems([{
      uri,
      filename: `photo-${Date.now()}.jpg`,
      isVideo: false,
      duration: 0,
    }]);
  }, []);

  // The mic swaps the composer for the recorder; the recorder hands back the
  // finished take, which uploads like any other attachment.
  const onVoice = useCallback(() => setRecording(true), []);

  const sendVoice = useCallback(async ({ fileB64, fileName, mimetype, duration }) => {
    setRecording(false);
    await pushMedia({ kind: 'audio', fileB64, fileName, mimetype, duration });
  }, [pushMedia]);

  const attachItems = [
    { key: 'gallery', label: 'Gallery', icon: 'image', lib: 'mc', bg: COLORS.violetBg, fg: COLORS.violet, onPress: () => pickGallery(['images', 'videos']) },
    { key: 'camera', label: 'Camera', icon: 'camera', lib: 'mc', bg: COLORS.pinkBg, fg: COLORS.pink, onPress: () => setCameraOpen(true) },
    { key: 'document', label: 'Document', icon: 'file-document', lib: 'mc', bg: COLORS.blueBg, fg: COLORS.link, onPress: pickDocument },
    { key: 'poll', label: 'Poll', icon: 'poll', lib: 'mc', bg: COLORS.cyanBg, fg: COLORS.cyan, onPress: () => setPollOpen(true) },
    // A tile here is an action that will work. When Meet is not connected, or
    // the workspace limits it to the other chat type, the tile drops out —
    // AttachSheet already filters falsy entries. The ⋮ keeps an entry either way
    // so the feature is still discoverable (and reachable, for an admin).
    canMeet && { key: 'meet', label: 'Meeting', icon: 'video', lib: 'mc', bg: COLORS.greenBg, fg: COLORS.green, onPress: () => headerAction('meet') },
    { key: 'audio', label: 'Audio', icon: 'music-note', lib: 'mc', bg: COLORS.orangeBg, fg: COLORS.orange, onPress: onVoice },
  ];

  // The ⋮ entry always exists, but says what is actually true right now.
  const meetMenuItem = (() => {
    const icon = 'videocam-outline';
    // Status not back yet — offer the normal action; startMeet re-checks anyway.
    if (!gmeet || canMeet) return { icon, label: 'Start a meeting', onPress: () => headerAction('meet') };
    if (!gmeet.connected) {
      return gmeet.isAdmin
        ? { icon, label: 'Set up Google Meet', onPress: () => onOpenGmeet?.() }
        : {
            icon,
            label: 'Meetings not set up',
            onPress: () => Alert.alert(
              'Google Meet not connected',
              'An administrator needs to connect the shared Google account in Odoo before meetings can be created.',
            ),
          };
    }
    const only = gmeet.scope === 'groups' ? 'group chats' : 'direct chats';
    return {
      icon,
      label: `Meetings are ${gmeet.scope === 'groups' ? 'group' : '1:1'}-only here`,
      onPress: () => Alert.alert('Not allowed', `Meetings are limited to ${only} in this workspace.`),
    };
  })();

  // ── message actions ────────────────────────────────────────────────────────
  // Applied optimistically where the server echoes the updated message back, and
  // by refetch where it doesn't (forward tells you nothing; delete-for-me returns
  // only a removal flag and is never broadcast).
  const replaceMsg = (m) => setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));

  const act = useCallback(async (kind, m) => {
    setSelMenu(false);
    // Reply and edit keep the selection alive only long enough to seed the
    // composer; everything else drops it so the header returns to normal.
    setSelected(null);
    try {
      if (kind === 'reply') { setReplyTo(m); return; }
      if (kind === 'edit') { setEditing(m); return; }
      if (kind === 'forward') { setForwarding(m); return; }
      if (kind === 'star') { replaceMsg(await chat.star(m.id, !m.starred)); return; }
      if (kind === 'pin') {
        // Unpinning is immediate; pinning asks for how long, as the web client
        // does. The server only accepts 1 | 7 | 14 | 30 and always stores an
        // expiry — there is no "pin forever" through this API.
        if (m.pinned) {
          replaceMsg(await chat.pinMessage(m.id, false));
          loadPinned();
        } else {
          setPinAsk(m);
        }
        return;
      }
      if (kind === 'info') {
        // The route returns names, avatars and per-person timestamps; this used
        // to reduce all of it to two counts in an Alert.
        setMsgInfo({ loading: true, message: m });
        setSelected(null);
        try { setMsgInfo({ message: m, ...(await chat.messageInfo(m.id)) }); }
        catch (e) { setMsgInfo(null); Alert.alert('Failed', e?.message || 'Please try again.'); }
        return;
      }
      // Copy means copy — straight to the clipboard, no share sheet.
      if (kind === 'copy') {
        setSelected(null);
        const ok = await copyText(m.body);
        if (!ok) Alert.alert('Could not copy', 'The clipboard is not available on this device.');
        return;
      }
      // Opens the 1:1 with the group message carried across as a quote. The
      // server takes quote_author/quote_body for exactly this — a reply_to_id
      // only points within one conversation.
      if (kind === 'replyPrivately') {
        setSelected(null);
        const conv = await chat.openDirect(m.authorId);
        onReplyPrivately?.(conv, { authorName: m.authorName, body: m.body || '' });
        return;
      }
      if (kind === 'deleteMe') {
        const res = await chat.deleteMessage(m.id, 'me');
        if (res.removed) {
          seenIds.current.delete(m.id);
          setMessages((prev) => prev.filter((x) => x.id !== m.id));
        }
        return;
      }
      if (kind === 'deleteAll') {
        const res = await chat.deleteMessage(m.id, 'everyone');
        if (res.message) replaceMsg(res.message);
        return;
      }
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Please try again.');
    }
  }, []);

  // Delete always confirms first, through the app's own ConfirmDialog rather
  // than a native Alert: an Alert follows the ANDROID theme, which is still
  // pinned light, so it renders white even in dark mode. ConfirmDialog is an
  // in-tree layer, not a <Modal>, so it also sidesteps the Android
  // Modal-inside-Modal race that made this show nothing at all.
  const confirmDelete = useCallback((msg) => {
    if (!msg) return;
    setSelMenu(false);
    setConfirmDel(msg);
  }, []);

  const runDelete = useCallback((scope) => {
    const msg = confirmDel;
    setConfirmDel(null);
    setSelected(null);
    if (msg) act(scope, msg);
  }, [confirmDel, act]);

  // The server only allows editing your own message within 15 minutes, and only
  // the author may delete for everyone — mirror both so nobody taps into an error.
  const canEdit = (m) => m.mine && !m.deleted && m.kind === 'text'
    && Date.now() - new Date(m.created).getTime() < 15 * 60 * 1000;

  // Tapping an existing chip toggles your own reaction off (the server treats an
  // empty emoji as "remove"), which is what tapping your own chip should do.
  const react = useCallback(async (m, emoji) => {
    setSelected(null);
    setEmojiPick(null);
    try {
      const has = (m.reactions || []).some((r) => r.emoji === emoji && r.mine);
      replaceMsg(await chat.react(m.id, has ? '' : emoji));
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Could not react.');
    }
  }, []);

  const vote = useCallback(async (optionId) => {
    try { replaceMsg(await chat.votePoll(optionId)); }
    catch (e) { Alert.alert('Failed', e?.message || 'Could not vote.'); }
  }, []);

  const submitEdit = useCallback(async (body) => {
    const m = editing;
    setEditing(null);
    try { replaceMsg(await chat.editMessage(m.id, body)); }
    catch (e) { Alert.alert('Could not edit', e?.message || 'The edit window may have passed.'); }
  }, [editing]);

  // Forward tells you nothing back and the server excludes you from its own
  // broadcast, so there is no way to confirm except by saying so.
  const doForward = useCallback(async (targetConvId) => {
    const m = forwarding;
    setForwarding(null);
    try {
      await chat.forwardMessage(m.id, targetConvId);
      Alert.alert('Forwarded', 'The message has been sent.');
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Could not forward.');
    }
  }, [forwarding]);

  // Tapping an attachment RUNS it. Images open full-screen in-app; video, audio
  // and documents go straight to the OS handler — no intermediate Play/Open step.
  const openMedia = useCallback(async (m) => {
    log.info('open media', { id: m.id, kind: m.kind, hasMedia: m.hasMedia, url: !!m.mediaUrl });
    // The server sets has_media false for a deleted message, and for view-once
    // media that has already been consumed — including for the sender, always.
    if (!m.hasMedia || !m.mediaUrl) {
      Alert.alert(
        'Not available',
        m.deleted
          ? 'This message was deleted.'
          : m.viewOnce
            ? 'This was a view-once file and can no longer be opened.'
            : 'The server did not provide this attachment.',
      );
      return;
    }
    // Video now plays in MediaViewer too, which also means a view-once video
    // burns on close like a photo instead of at hand-off — see the viewer's
    // onClose. Audio and documents still go to the OS.
    if (m.kind === 'image' || m.kind === 'video') { setViewerMsg(m); return; }
    setOpening(m.id);
    try {
      await openAttachment(m);
      // Handed to the OS viewer, so there is no "closed" moment to hook —
      // opening IS the consumption.
      if (m.viewOnce) await burnViewOnce(m);
    } catch (e) {
      Alert.alert('Could not open', e?.message || 'The file could not be opened.');
    } finally {
      setOpening(null);
    }
  }, []);

  // Consume a view-once message: the server drops its media and flips `viewed`,
  // and the bubble then renders "Opened". Deliberately fire-and-reconcile — the
  // user has already seen the photo, so a failed call must not look like it
  // wasn't viewed.
  const burnViewOnce = useCallback(async (m) => {
    try { replaceMsg(await chat.viewOnceSeen(m.id)); }
    catch (e) { log.warn('view-once burn failed', e?.message); }
  }, []);

  // Debounced in-thread search. /chat/search_messages is a plain ILIKE with a
  // 100-result cap, newest first.
  useEffect(() => {
    const q = searchQ.trim();
    clearTimeout(searchTimer.current);
    if (!searchMode || !q) { setSearchHits(null); setSearchBusy(false); return undefined; }
    setSearchBusy(true);
    searchTimer.current = setTimeout(async () => {
      try { setSearchHits(await chat.searchMessages(convId, q)); setSearchIdx(0); }
      catch (e) { log.warn('in-thread search failed', e?.message); setSearchHits([]); }
      finally { setSearchBusy(false); }
    }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [searchQ, searchMode, convId]);

  const hitCount = (searchHits || []).length;

  // Walk the hits in place. Leaves search so the message is visible in the
  // thread, which is the only way to actually read it in context.
  const stepHit = useCallback((dir) => {
    const hits = searchHits || [];
    if (!hits.length) return;
    const next = Math.min(Math.max(searchIdx + dir, 0), hits.length - 1);
    setSearchIdx(next);
    const target = hits[next];
    if (target) { setSearchMode(false); jumpTo(target.id); }
  }, [searchHits, searchIdx, jumpTo]);

  const closeSearch = useCallback(() => {
    setSearchMode(false);
    setSearchQ('');
    setSearchHits(null);
    setSearchIdx(0);
  }, []);

  // Android back unwinds the thread's own modes before leaving the thread.
  // Selection is checked first because it is the more recently opened of the two
  // — the registry is LIFO, so registration order here decides nothing, but
  // either mode must be cleared rather than dumping the user back at the list.
  useBackIntercept(searchMode, () => { closeSearch(); return true; });
  useBackIntercept(!!selected, () => { setSelected(null); setSelMenu(false); return true; });

  // Jump to a message by id — used by the pinned banner and by search hits.
  // If it is already loaded we just scroll; if not, pull the window around it.
  const jumpTo = useCallback(async (messageId) => {
    if (!messageId) return;
    if (messages.some((m) => m.id === messageId)) { setHighlightId(messageId); return; }
    try {
      const around = await chat.fetchMessagesAround(convId, messageId);
      if (!around.length) return;
      seenIds.current = new Set(around.map((m) => m.id));
      setMessages(around.slice().reverse());
      // Not the newest page any more, so older pages may still exist.
      setExhausted(false);
      setHighlightId(messageId);
    } catch (e) {
      log.warn('jump failed', e?.message);
      Alert.alert('Could not open', e?.message || 'That message could not be loaded.');
    }
  }, [messages, convId]);

  // Unpin straight from the banner. The pinned row is a lighter shape than a
  // thread message, so this goes through the id rather than replaceMsg — the
  // message may not even be loaded in the current window.
  const unpin = useCallback(async (pm) => {
    if (!pm?.id) return;
    try {
      await chat.pinMessage(pm.id, false);
      setPinned((prev) => prev.filter((p) => p.id !== pm.id));
      setMessages((prev) => prev.map((x) => (x.id === pm.id ? { ...x, pinned: false } : x)));
    } catch (e) {
      Alert.alert('Could not unpin', e?.message || 'Please try again.');
    }
  }, []);

  const loadPinned = useCallback(async () => {
    try { setPinned(await chat.fetchPinned(convId)); } catch (_) { /* banner is optional */ }
  }, [convId]);

  useEffect(() => { loadPinned(); }, [loadPinned]);

  // ── header menu ────────────────────────────────────────────────────────────
  const headerAction = useCallback(async (kind) => {
    setMenuOpen(false);
    try {
      if (kind === 'info') { onOpenInfo?.(); return; }
      // Search happens in place: the header becomes a search field and the list
      // narrows to matches, rather than pushing a separate screen.
      if (kind === 'search') { setSearchMode(true); return; }
      if (kind === 'media') { onOpenMedia?.(); return; }
      if (kind === 'starred') { onOpenStarred?.(); return; }
      if (kind === 'meet') { await startMeet(); return; }
      if (kind === 'mute') { setMuteAsk(true); return; }
      if (kind === 'markUnread') { await chat.markUnread(convId); onBack?.(); return; }
      // Same reasoning as the delete confirm: opened from the ⋮ (a Modal), so a
      // second Modal would lose the race, and a native Alert would be white on
      // dark. ConfirmDialog is an in-tree layer and follows the palette.
      if (kind === 'clear') { setConfirmClear(true); return; }
      // /chat/export returns text/plain, not the JSON envelope. Written to cache
      // and handed to the share sheet, which is how every other file leaves the
      // app (utils/openAttachment) — no new native module needed.
      if (kind === 'export') {
        const text = await chat.fetchTranscript(convId);
        const safe = String(conversation?.title || 'chat').replace(/[^A-Za-z0-9_-]+/g, '_');
        const path = `${FileSystem.cacheDirectory}369chats_${safe}.txt`;
        await FileSystem.writeAsStringAsync(path, text);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: 'Export chat' });
        } else {
          Alert.alert('Exported', `Saved to ${path}`);
        }
        return;
      }
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Please try again.');
    }
  }, [convId, isGroup, onOpenInfo, onOpenSearch, onOpenMedia, onOpenStarred, onBack, startMeet]);

  // ── render ─────────────────────────────────────────────────────────────────
  // Inverted list: index 0 sits at the BOTTOM, and messages[index + 1] is the
  // older message rendered directly ABOVE this one. Cells themselves are already
  // un-flipped by FlatList, so inside a cell children stack top-to-bottom as
  // normal — the divider must come BEFORE the bubble to appear above it, and no
  // manual scaleY is needed anywhere.
  const renderItem = ({ item, index }) => {
    const older = messages[index + 1];
    // This row is the oldest of its day when the row above it belongs to another
    // day — that's where the divider goes.
    const newDay = !older || dayKey(older.created) !== dayKey(item.created);
    // In groups, only label the first of a run from the same author.
    const showAuthor = isGroup && (!older || older.authorId !== item.authorId);
    const isSel = selected?.id === item.id;
    const isHit = highlightId === item.id;
    return (
      <View style={[isSel && s.selectedRow, isHit && s.hitRow]}>
        {newDay && !!item.created && (
          <View style={s.dayWrap}><Text style={s.dayTxt}>{dayLabel(item.created)}</Text></View>
        )}
        {/* Reaction strip, floating directly above the selected bubble. Rendered
            in the cell rather than absolutely positioned so it can never end up
            off-screen on a short or very long message. */}
        {/* Not for call cards: reacting to a call record is meaningless, and the
            server stores them as system messages that no client renders
            reactions on anyway. */}
        {isSel && !item.deleted && !item.isCall && (
          <View style={[s.reactStrip, item.mine ? s.reactStripMine : s.reactStripTheirs]}>
            {QUICK_REACTIONS.map((e) => {
              const on = (item.reactions || []).some((r) => r.emoji === e && r.mine);
              return (
                <TouchableOpacity
                  key={e}
                  style={[s.reactPickBtn, on && s.reactPickBtnOn]}
                  onPress={() => react(item, e)}
                  activeOpacity={0.7}
                >
                  <Text style={s.reactPickEmoji}>{e}</Text>
                </TouchableOpacity>
              );
            })}
            {/* + opens the full set, like the web client. */}
            <TouchableOpacity style={s.reactPlus} onPress={() => setEmojiPick(item)} activeOpacity={0.7}>
              <Ionicons name="add" size={19} color={COLORS.slate500} />
            </TouchableOpacity>
          </View>
        )}
        <MessageBubble
          msg={toBubble(item)}
          showAuthor={showAuthor}
          highlight={searchQ.trim()}
          onLongPress={() => setSelected(item)}
          // Only offer the viewer when the server actually served media —
          // has_media is false for deleted and burned view-once messages.
          // Always attached for media kinds. Gating this on hasMedia made a tap
          // do NOTHING when the server withheld the file, which is
          // indistinguishable from a broken button — openMedia now explains why.
          onMediaPress={
            ['image', 'video', 'audio', 'document'].includes(item.kind)
              ? () => openMedia(item)
              : undefined
          }
          onReact={(emoji) => react(item, emoji)}
          onVote={vote}
          onMeet={(url) => Linking.openURL(url).catch(() => Alert.alert('Could not open', url))}
          onOpenLink={(url) => Linking.openURL(url).catch(() => Alert.alert('Could not open', url))}
        />
      </View>
    );
  };

  // The message list, shared by both header states so selecting a message never
  // unmounts and re-fetches the thread. `extraData` is required: the selection
  // lives outside the row data, so FlatList would not otherwise re-render the
  // row that needs the reaction strip.
  const threadBody = loading ? (
    <Loader />
  ) : error ? (
    <EmptyState icon="alert-circle-outline" tone="error" title={error} onRetry={load} />
  ) : (
    <FlatList
      ref={listRef}
      inverted
      data={messages}
      keyExtractor={(m) => String(m.id)}
      renderItem={renderItem}
      extraData={selected}
      contentContainerStyle={{ paddingVertical: SPACING.md, flexGrow: 1 }}
      onEndReached={loadOlder}
      onEndReachedThreshold={0.4}
      keyboardDismissMode="interactive"
      // Inverted list: offset 0 IS the newest message, so "scrolled away from
      // the bottom" means a positive offset.
      onScroll={(e) => setAtBottom(e.nativeEvent.contentOffset.y < 80)}
      scrollEventThrottle={64}
      // Inverted: the "footer" renders at the TOP, which is where an older-page
      // spinner belongs.
      ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 14 }} color={COLORS.primary} /> : null}
      ListEmptyComponent={
        <EmptyState icon="chatbubble-ellipses-outline" title="No messages yet" sub="Say hello." />
      }
    />
  );

  // Search takes over the header in place — no separate screen — and the body
  // becomes the hit list. Tapping a hit jumps the thread to that message.
  if (searchMode) {
    return (
      <Screen>
        <View style={[s.header, s.selHeader, { paddingTop: TOP }]}>
          <TouchableOpacity onPress={closeSearch} hitSlop={HIT} style={s.iconBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.navy} />
          </TouchableOpacity>
          <View style={s.searchField}>
            <Ionicons name="search" size={17} color={COLORS.faint} />
            <TextInput
              style={s.searchInput}
              value={searchQ}
              onChangeText={setSearchQ}
              placeholder={`Search in ${conversation?.title || 'this chat'}`}
              placeholderTextColor={COLORS.faint}
              autoFocus
              returnKeyType="search"
            />
            {searchBusy && <ActivityIndicator size="small" color={COLORS.primary} />}
            {!!searchQ && !searchBusy && (
              <TouchableOpacity onPress={() => setSearchQ('')} hitSlop={HIT}>
                <Ionicons name="close-circle" size={17} color={COLORS.faint} />
              </TouchableOpacity>
            )}
          </View>
          {/* n/N stepper: walk hits without leaving search, the way the web
              client does. Newest-first, so ∨ goes to older matches. */}
          {!!hitCount && (
            <View style={s.stepper}>
              <TouchableOpacity onPress={() => stepHit(-1)} hitSlop={HIT} disabled={searchIdx <= 0}>
                <Ionicons name="chevron-up" size={20} color={searchIdx <= 0 ? COLORS.faint : COLORS.primary} />
              </TouchableOpacity>
              <Text style={s.stepTxt}>{searchIdx + 1}/{hitCount}</Text>
              <TouchableOpacity
                onPress={() => stepHit(1)}
                hitSlop={HIT}
                disabled={searchIdx >= hitCount - 1}
              >
                <Ionicons
                  name="chevron-down" size={20}
                  color={searchIdx >= hitCount - 1 ? COLORS.faint : COLORS.primary}
                />
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={{ flex: 1, paddingBottom: kb > 0 ? kb + insets.bottom : insets.bottom }}>
          <FlatList
            data={searchHits || []}
            keyExtractor={(m) => `h${m.id}`}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={(searchHits || []).length ? { paddingBottom: 24 } : { flexGrow: 1 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={s.hitItem}
                activeOpacity={0.75}
                onPress={() => { closeSearch(); jumpTo(item.id); }}
              >
                <View style={s.hitHead}>
                  <Text style={s.hitWho} numberOfLines={1}>{item.mine ? 'You' : item.authorName}</Text>
                  <Text style={s.hitWhen}>{timeOf(item.created)}</Text>
                </View>
                <Text style={s.hitBody} numberOfLines={2}>
                  {item.body || item.fileName || `[${item.kind}]`}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <EmptyState
                icon="search-outline"
                title={
                  !searchQ.trim() ? 'Search this chat'
                    : searchBusy ? 'Searching…' : 'No matches'
                }
                sub={!searchQ.trim() ? 'Find anything said in this conversation.' : undefined}
              />
            }
          />
        </View>
      </Screen>
    );
  }

  // While a message is selected the header becomes an action bar. The frequent
  // verbs get their own icon; everything else hides under ⋮, as WhatsApp does.
  // While a message is selected the header becomes an action bar.
  //
  // This used to be an early `return` of a whole second <Screen>. React then saw
  // a different tree, unmounted the FlatList and mounted a new one — and an
  // inverted list starts at offset 0, which is the NEWEST message. That is why
  // long-pressing a message snapped the thread down to the bottom instead of
  // staying put. Everything below is now built as values and slotted into the
  // single return, so the list is never torn down.
  const m = selected;

  const selectionBar = selected ? (
    <View style={[s.header, s.selHeader, { paddingTop: TOP }]}>
          <TouchableOpacity onPress={() => setSelected(null)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={s.iconBtn}>
            <Ionicons name="close" size={23} color={COLORS.navy} />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          {/* A call record is not a message: replying to it, starring it or
              forwarding it makes no sense, and pin/copy/edit even less. It gets
              Info and Delete, nothing else — so there is no ⋮ either. */}
          {m.isCall ? (
            <>
              {m.mine && (
                <TouchableOpacity onPress={() => act('info', m)} hitSlop={HIT} style={s.selBtn}>
                  <Ionicons name="information-circle-outline" size={22} color={COLORS.navy} />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => confirmDelete(m)} hitSlop={HIT} style={s.selBtn}>
                <Ionicons name="trash-outline" size={21} color={COLORS.red} />
              </TouchableOpacity>
            </>
          ) : (
            <>
              {!m.deleted && (
                <>
                  <TouchableOpacity onPress={() => { setSelected(null); setReplyTo(m); }} hitSlop={HIT} style={s.selBtn}>
                    <Ionicons name="arrow-undo-outline" size={21} color={COLORS.navy} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => act('star', m)} hitSlop={HIT} style={s.selBtn}>
                    <Ionicons name={m.starred ? 'star' : 'star-outline'} size={21} color={m.starred ? COLORS.amber : COLORS.navy} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => act('forward', m)} hitSlop={HIT} style={s.selBtn}>
                    <Ionicons name="arrow-redo-outline" size={21} color={COLORS.navy} />
                  </TouchableOpacity>
                </>
              )}
              <TouchableOpacity onPress={() => confirmDelete(m)} hitSlop={HIT} style={s.selBtn}>
                <Ionicons name="trash-outline" size={21} color={COLORS.red} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSelMenu(true)} hitSlop={HIT} style={s.selBtn}>
                <Ionicons name="ellipsis-vertical" size={20} color={COLORS.navy} />
              </TouchableOpacity>
            </>
          )}
    </View>
  ) : null;

  const selectionMenu = selected ? (
    <MenuPopup
      visible={selMenu}
      onClose={() => setSelMenu(false)}
      items={[
        !m.deleted && {
          key: 'pin', icon: m.pinned ? 'pin' : 'pin-outline',
          label: m.pinned ? 'Unpin' : 'Pin', onPress: () => act('pin', m),
        },
        canEdit(m) && { key: 'edit', icon: 'create-outline', label: 'Edit', onPress: () => act('edit', m) },
        !m.deleted && !!m.body && { key: 'copy', icon: 'copy-outline', label: 'Copy', onPress: () => act('copy', m) },
        // Reply privately: only from a GROUP, and never to yourself — it opens
        // the 1:1 and carries the quote across, which is what the cross-chat
        // quote_author/quote_body fields on /chat/send exist for.
        isGroup && !m.mine && !m.deleted && {
          key: 'replypriv', icon: 'arrow-undo-outline', label: 'Reply privately',
          onPress: () => act('replyPrivately', m),
        },
        m.mine && { key: 'info', icon: 'checkmark-done-outline', label: 'Info', onPress: () => act('info', m) },
        // Opens the same confirmation the trash icon does. This used to
        // delete on tap with no dialog at all.
        { key: 'delme', icon: 'trash-outline', label: 'Delete', tone: 'danger', onPress: () => confirmDelete(m) },
      ]}
    />
  ) : null;


  const emojiDialog = (
        <PopupModal visible={!!emojiPick} onClose={() => setEmojiPick(null)} title="React">
          <View style={s.emojiWrap}>
            {ALL_REACTIONS.map((e) => (
              <TouchableOpacity key={e} style={s.emojiCell} onPress={() => react(emojiPick, e)} activeOpacity={0.6}>
                <Text style={s.emojiBig}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </PopupModal>
  );

  return (
    <Screen>
      {selectionBar}
      <View style={[s.header, { paddingTop: TOP }, selected && s.hidden]} pointerEvents={selected ? 'none' : 'auto'}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={s.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={COLORS.navy} />
        </TouchableOpacity>
        <TouchableOpacity style={s.headerBody} onPress={onOpenInfo} activeOpacity={0.8}>
          <Avatar name={conversation?.title} uri={conversation?.avatarUrl} size={38} />
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle} numberOfLines={1}>{conversation?.title}</Text>
            {/* Typing wins over presence while it lasts; otherwise "online" or
                "last seen …". An empty string is a valid answer — the server
                withholds presence when privacy or a block says so. */}
            <Text
              style={[s.headerSub, !typingName && !conversation?.online && s.headerSubIdle]}
              numberOfLines={1}
            >
              {typingName
                ? `${isGroup ? `${typingName} is ` : ''}typing…`
                : presenceText({
                  online: conversation?.online,
                  lastSeen: conversation?.lastSeen,
                  isGroup,
                  memberCount: conversation?.memberCount,
                })}
            </Text>
          </View>
        </TouchableOpacity>
        {/* Voice and video, opposite the name, exactly where WhatsApp puts them.
            Shown for any 1:1 you are actually in — deliberately NOT gated on the
            WebRTC module being present. Hiding them when it is missing made the
            buttons silently vanish on a build without the native module, which
            reads as "the feature is gone" rather than "this build can't".
            placeCall explains that case instead. Groups stay excluded: the
            server refuses group calls outright. */}
        {showCall && (
          <>
            <TouchableOpacity
              onPress={() => placeCall(true)}
              hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
              style={s.iconBtn}
              accessibilityRole="button"
              accessibilityLabel="Video call"
            >
              <Ionicons name="videocam-outline" size={22} color={COLORS.navy} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => placeCall(false)}
              hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
              style={s.iconBtn}
              accessibilityRole="button"
              accessibilityLabel="Voice call"
            >
              <Ionicons name="call-outline" size={21} color={COLORS.navy} />
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          onPress={() => setMenuOpen(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={s.iconBtn}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={COLORS.navy} />
        </TouchableOpacity>
      </View>

      {/* Pinned banner — max 3 server-side, and pins always carry an expiry. */}
      {!!pinned.length && (
        <TouchableOpacity
          style={s.pinBar}
          activeOpacity={0.8}
          // One pin jumps straight to it. Several open the list, like the web —
          // cycling an index made you tap blind through the others to reach the
          // one you wanted, with no idea what they were.
          onPress={() => {
            if (pinned.length > 1) setPinsOpen(true);
            else jumpTo(pinned[0]?.id);
          }}
        >
          <Ionicons name="pin" size={15} color={COLORS.primary} />
          <View style={{ flex: 1 }}>
            <Text style={s.pinTxt} numberOfLines={1}>
              {pinned[0]?.body || pinned[0]?.fileName || 'Pinned message'}
            </Text>
            {/* Every pin expires (1/7/14/30 days). Not showing it meant a pin
                disappeared with no warning — the web has shown this all along. */}
            {!!pinLeft(pinned[0]?.pinExpiry) && (
              <Text style={s.pinLeft}>{pinLeft(pinned[0]?.pinExpiry)}</Text>
            )}
          </View>
          {pinned.length > 1 && (
            <Text style={s.pinCount}>+{pinned.length - 1} more</Text>
          )}
          {/* Unpin without hunting for the message first, as the web allows. */}
          <TouchableOpacity
            onPress={() => unpin(pinned[0])}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={16} color={COLORS.slate400} />
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      {/* paddingBottom, not KeyboardAvoidingView — see utils/useKeyboardHeight.
          Keyboard UP: pad by keyboard + inset. Android reports the keyboard
          height measured from ABOVE the navigation bar under edge-to-edge, so
          taking max() left the composer short by exactly the nav-bar height and
          it hid behind the keyboard's toolbar row.
          Keyboard DOWN: just the inset, to clear the nav/gesture bar. */}
      <View style={{ flex: 1, paddingBottom: kb > 0 ? kb + insets.bottom : insets.bottom }}>
        {threadBody}

        {/* Jump to the newest message. Inverted list, so "bottom" is offset 0. */}
        {!atBottom && messages.length > 0 && (
          <TouchableOpacity
            style={[s.scrollDown, { bottom: emojiOpen ? lastKb.current + 76 : 76 }]}
            onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
            activeOpacity={0.85}
          >
            <Ionicons name="chevron-down" size={22} color={COLORS.primary} />
          </TouchableOpacity>
        )}

        {/* No composer while a message is selected — the action bar owns the
            screen. Rendered as null in the SAME slot rather than by swapping
            trees, so the list above is untouched. */}
        {selected ? null : recording ? (
          <VoiceRecorder
            onCancel={() => setRecording(false)}
            onSend={sendVoice}
            sending={sending}
          />
        ) : editing ? (
          <EditBar
            message={editing}
            onCancel={() => setEditing(null)}
            onSubmit={submitEdit}
          />
        ) : (
          <Composer
            onSend={send}
            onAttach={() => setAttachOpen(true)}
            onCamera={() => setCameraOpen(true)}
            onVoice={onVoice}
            onTyping={typing}
            initialDraft={draftFor(convId)}
            onDraftChange={(t) => setDraft(convId, t)}
            sending={sending}
            uploadPct={uploadPct}
            replyTo={replyTo}
            // The lock row has existed in Composer from the start with nothing
            // ever passing these, so a blocked contact or a read-only oversight
            // row still showed a live composer: you typed, hit send, and only
            // then got a rejection Alert from the server.
            disabled={!!conversation?.oversight || !!conversation?.blockedByMe}
            disabledReason={conversation?.oversight
              ? 'Monitoring (read-only) — you are not a member of this chat.'
              : 'You blocked this contact. Unblock them from Contact info to send messages.'}
            onCancelReply={() => setReplyTo(null)}
            emojiOpen={emojiOpen}
            onToggleEmoji={setEmojiOpen}
            panelHeight={lastKb.current}
          />
        )}
      </View>

      {selectionMenu}
      {emojiDialog}

      {/* Message info — who received it and who read it, with the times. */}
      <PopupModal
        visible={!!msgInfo}
        onClose={() => setMsgInfo(null)}
        title="Message info"
        subtitle={msgInfo?.message?.body ? String(msgInfo.message.body).slice(0, 80) : undefined}
      >
        {msgInfo?.loading ? (
          <View style={{ padding: SPACING.xl }}><ActivityIndicator color={COLORS.primary} /></View>
        ) : (
          <ScrollView style={{ maxHeight: 380 }}>
            <InfoGroup
              icon="checkmark-done" tint={COLORS.readTick} label="Read by"
              count={msgInfo?.read?.length || 0}
              total={msgInfo?.isGroup ? msgInfo.memberCount : 0}
              people={msgInfo?.read || []}
            />
            <InfoGroup
              icon="checkmark-done" tint={COLORS.slate400} label="Delivered to"
              count={msgInfo?.delivered?.length || 0}
              total={msgInfo?.isGroup ? msgInfo.memberCount : 0}
              people={msgInfo?.delivered || []}
            />
          </ScrollView>
        )}
      </PopupModal>

      {/* Header ⋮ — drops from the button, like WhatsApp. */}
      <MenuPopup
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={[
          { icon: 'information-circle-outline', label: isGroup ? 'Group info' : 'Contact info', onPress: () => headerAction('info') },
          { icon: 'search-outline', label: 'Search', onPress: () => headerAction('search') },
          { icon: 'images-outline', label: 'Media, links, docs', onPress: () => headerAction('media') },
          { icon: 'star-outline', label: 'Starred messages', onPress: () => headerAction('starred') },
          // Poll lives in the attach sheet (📎 → Poll), where the other things
          // you can put IN a message live. It was duplicated here.
          meetMenuItem,
          { icon: 'notifications-off-outline', label: 'Mute notifications', onPress: () => headerAction('mute') },
          { icon: 'mail-unread-outline', label: 'Mark as unread', onPress: () => headerAction('markUnread') },
          { icon: 'download-outline', label: 'Export chat', onPress: () => headerAction('export') },
          { icon: 'trash-outline', label: 'Clear chat', tone: 'danger', onPress: () => headerAction('clear') },
        ]}
      />

      {/* (The long-press bottom sheet was replaced by the contextual header bar
          + reaction strip above, which is the WhatsApp interaction.) */}

      <ForwardSheet
        visible={!!forwarding}
        onClose={() => setForwarding(null)}
        onPick={doForward}
      />

      <PollSheet
        visible={pollOpen}
        onClose={() => setPollOpen(false)}
        onCreate={async (q, opts, multi) => {
          setPollOpen(false);
          try {
            const m = await chat.createPoll(convId, q, opts, multi);
            seenIds.current.add(m.id);
            realtime.noteMessageId(m.id);
            setMessages((prev) => [m, ...prev]);
          } catch (e) { Alert.alert('Failed', e?.message || 'Could not create the poll.'); }
        }}
      />

      <AttachSheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        items={attachItems}
        onPickAsset={sendGalleryAsset}
      />

      <CameraCaptureModal
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={onCaptured}
      />

      {/* Fetching an attachment before the OS takes over — brief, but a silent
          pause after a tap reads as a broken button. */}
      {opening != null && (
        <View style={s.opening} pointerEvents="none">
          <ActivityIndicator color={COLORS.onPrimary} size="small" />
          <Text style={s.openingTxt}>Opening…</Text>
        </View>
      )}

      {/* Pin duration. The API takes only these four; "forever" isn't offered
          because the server would reject it. */}
      <PopupModal visible={!!pinAsk} onClose={() => setPinAsk(null)} title="Pin this message for">
        {PIN_DAYS.map((d) => (
          <TouchableOpacity
            key={d.days}
            style={s.askRow}
            activeOpacity={0.75}
            onPress={async () => {
              const m = pinAsk;
              setPinAsk(null);
              try { replaceMsg(await chat.pinMessage(m.id, true, d.days)); loadPinned(); }
              catch (e) { Alert.alert('Failed', e?.message || 'Could not pin.'); }
            }}
          >
            <Text style={s.askTxt}>{d.label}</Text>
          </TouchableOpacity>
        ))}
        <Text style={s.askNote}>Up to 3 messages can be pinned in a chat.</Text>
      </PopupModal>

      {/* Mute duration, including "until I turn it off" (hours: 0 = forever). */}
      {/* Every pin at once, with author, time left and a per-item unpin —
          matching the web's pinned-messages modal. Tapping one jumps to it. */}
      <PopupModal
        visible={pinsOpen}
        onClose={() => setPinsOpen(false)}
        title={`Pinned messages (${pinned.length})`}
      >
        <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
          {pinned.map((pm) => (
            <TouchableOpacity
              key={pm.id}
              style={s.pinRow}
              activeOpacity={0.75}
              onPress={() => { setPinsOpen(false); jumpTo(pm.id); }}
            >
              <Ionicons name="pin" size={15} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.pinRowAuthor} numberOfLines={1}>
                  {pm.mine ? 'You' : (pm.authorName || 'Someone')}
                </Text>
                <Text style={s.pinRowBody} numberOfLines={2}>
                  {pm.body || pm.fileName || 'Message'}
                </Text>
                {!!pinLeft(pm.pinExpiry) && (
                  <Text style={s.pinLeft}>{pinLeft(pm.pinExpiry)}</Text>
                )}
              </View>
              <TouchableOpacity
                onPress={() => unpin(pm)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={17} color={COLORS.slate400} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </PopupModal>

      <MuteSheet
        visible={muteAsk}
        onClose={() => setMuteAsk(false)}
        onPick={async (hours, opt) => {
          try {
            await chat.muteConversation(convId, true, hours);
            Alert.alert('Muted', `Notifications are off ${opt.confirm}.`);
          } catch (e) { Alert.alert('Failed', e?.message || 'Could not mute.'); }
        }}
      />

      <MediaPreview
        visible={!!previewItems?.length}
        items={previewItems || []}
        sending={sending}
        onCancel={() => setPreviewItems(null)}
        onSend={sendReviewed}
      />

      <MediaViewer
        visible={!!viewerMsg}
        message={viewerMsg}
        onClose={() => {
          const m = viewerMsg;
          setViewerMsg(null);
          if (m?.viewOnce) burnViewOnce(m);
        }}
      />

      {/* Last in the tree on purpose: it is an in-tree layer, not a <Modal>, so
          paint order is what puts it on top. */}
      <ConfirmDialog
        visible={!!confirmDel}
        icon="trash-outline"
        title="Delete message?"
        message={confirmDel?.canDeleteAll
          ? 'Choose who this is removed for. Deleting for everyone cannot be undone.'
          : (confirmDel?.mine && !confirmDel?.deleted
            ? 'The 24-hour window to delete this for everyone has passed, so it can only be removed from your own copy.'
            : 'This message can only be removed from your own copy of the chat.')}
        actions={[
          {
            key: 'me',
            label: 'Delete for me',
            sub: 'Others keep their copy',
            tone: 'danger',
            onPress: () => runDelete('deleteMe'),
          },
          confirmDel?.canDeleteAll && {
            key: 'all',
            label: 'Delete for everyone',
            sub: 'Replaced with “This message was deleted”',
            tone: 'danger',
            onPress: () => runDelete('deleteAll'),
          },
        ]}
        onCancel={() => setConfirmDel(null)}
      />

      <ConfirmDialog
        visible={confirmClear}
        icon="brush-outline"
        title="Clear chat?"
        message="Every message is hidden from your copy of this chat. Other members keep theirs."
        actions={[{
          key: 'clear',
          label: 'Clear chat',
          tone: 'danger',
          onPress: async () => {
            setConfirmClear(false);
            try { await chat.clearChat(convId); setMessages([]); seenIds.current = new Set(); }
            catch (e) { Alert.alert('Failed', e?.message || 'Please try again.'); }
          },
        }]}
        onCancel={() => setConfirmClear(false)}
      />

      {/* Why a dialog and not setError(): `error` swaps the whole thread for an
          EmptyState, which is right for "this chat won't load" and very wrong for
          "the mic is blocked". */}
      <ConfirmDialog
        visible={!!callErr}
        icon="call-outline"
        tone="danger"
        title="Can't start the call"
        message={callErr || ''}
        actions={[]}
        cancelLabel="OK"
        onCancel={clearCallErr}
      />
    </Screen>
  );
}

// (MenuItem went with the long-press sheet — MenuPopup renders its own rows.)

// Replaces the composer while an edit is in flight. Seeded with the current body
// so the user amends rather than retypes.
// One half of the Message-info dialog: the people who read (or received) it,
// each with the time. In a 1:1 the "of N" is noise, so `total` is passed 0.
function InfoGroup({ icon, tint, label, count, total, people }) {
  return (
    <View style={s.infoGroup}>
      <View style={s.infoHead}>
        <Ionicons name={icon} size={16} color={tint} />
        <Text style={s.infoLabel}>{label}</Text>
        <Text style={s.infoCount}>{total ? `${count} of ${total}` : count}</Text>
      </View>
      {people.length ? people.map((p) => (
        <View key={p.userId} style={s.infoRow}>
          <Avatar name={p.name} uri={p.avatarUrl} size={30} />
          <Text style={s.infoName} numberOfLines={1}>{p.name}</Text>
          <Text style={s.infoAt}>{p.at ? timeOf(p.at) : ''}</Text>
        </View>
      )) : (
        <Text style={s.infoEmpty}>No one yet.</Text>
      )}
    </View>
  );
}

function EditBar({ message, onCancel, onSubmit }) {
  const [text, setText] = useState(message?.body || '');
  return (
    <View style={s.editWrap}>
      <View style={s.editHead}>
        <Ionicons name="create-outline" size={15} color={COLORS.primary} />
        <Text style={s.editTitle}>Editing message</Text>
        <TouchableOpacity onPress={onCancel} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={18} color={COLORS.slate500} />
        </TouchableOpacity>
      </View>
      <View style={s.editRow}>
        <TextInput style={s.editInput} value={text} onChangeText={setText} multiline autoFocus />
        <TouchableOpacity
          style={[s.editSend, !text.trim() && { backgroundColor: COLORS.slate400 }]}
          onPress={() => text.trim() && onSubmit(text.trim())}
          disabled={!text.trim()}
        >
          <Ionicons name="checkmark" size={20} color={COLORS.onPrimary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Pick a destination for a forwarded message. Loads the chat list on open.
function ForwardSheet({ visible, onClose, onPick }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    if (!visible) return;
    setBusy(true);
    chat.fetchConversations('all')
      .then((r) => setRows(r.conversations))
      .catch(() => setRows([]))
      .finally(() => setBusy(false));
  }, [visible]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Forward to">
      {busy ? <ActivityIndicator style={{ margin: 24 }} color={COLORS.primary} /> : (
        <ScrollView style={{ maxHeight: 380 }}>
          {rows.map((c) => (
            <TouchableOpacity key={c.id} style={s.fwdRow} onPress={() => onPick(c.id)} activeOpacity={0.75}>
              <Avatar name={c.title} uri={c.avatarUrl} size={38} />
              <Text style={s.fwdName} numberOfLines={1}>{c.title}</Text>
            </TouchableOpacity>
          ))}
          {!rows.length && <Text style={s.fwdEmpty}>No chats to forward to.</Text>}
        </ScrollView>
      )}
    </Sheet>
  );
}

// Poll builder. The server needs at least 2 non-blank options and keeps 12.
function PollSheet({ visible, onClose, onCreate }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [multi, setMulti] = useState(false);

  useEffect(() => { if (visible) { setQ(''); setOpts(['', '']); setMulti(false); } }, [visible]);

  const setOpt = (i, v) => setOpts((p) => p.map((o, k) => (k === i ? v : o)));
  const filled = opts.filter((o) => o.trim());
  const ready = q.trim() && filled.length >= 2;

  return (
    // Centred, not a bottom sheet: this is a form the user fills in, and the
    // keyboard pushing a sheet around left "Create poll" off-screen. Matches the
    // edit-profile dialog.
    <PopupModal
      visible={visible}
      onClose={onClose}
      title="Create poll"
      subtitle={`${filled.length} of ${opts.length} options filled`}
    >
      <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
        <View style={s.pollBody}>
          <TextInput style={s.pollInput} value={q} onChangeText={setQ} placeholder="Question" placeholderTextColor={COLORS.faint} />
          {opts.map((o, i) => (
            <View key={i} style={s.pollOptRowEdit}>
              <TextInput
                style={[s.pollInput, { flex: 1, marginBottom: 0 }]}
                value={o}
                onChangeText={(v) => setOpt(i, v)}
                placeholder={`Option ${i + 1}`}
                placeholderTextColor={COLORS.faint}
              />
              {/* The server needs 2; below that there is nothing to remove. */}
              {opts.length > 2 && (
                <TouchableOpacity
                  onPress={() => setOpts((p) => p.filter((_, k) => k !== i))}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close-circle" size={20} color={COLORS.faint} />
                </TouchableOpacity>
              )}
            </View>
          ))}
          {/* 12 is the server's cap (chat_api.py truncates past it). */}
          {opts.length < 12 && (
            <TouchableOpacity style={s.pollAdd} onPress={() => setOpts((p) => [...p, ''])}>
              <Ionicons name="add" size={17} color={COLORS.primary} />
              <Text style={s.pollAddTxt}>Add option</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.pollMulti} onPress={() => setMulti((m) => !m)} activeOpacity={0.8}>
            <Ionicons name={multi ? 'checkbox' : 'square-outline'} size={20} color={COLORS.primary} />
            <Text style={s.pollMultiTxt}>Allow multiple answers</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <View style={s.pollFoot}>
        <TouchableOpacity
          style={[s.pollBtn, !ready && { backgroundColor: COLORS.slate400 }]}
          disabled={!ready}
          onPress={() => onCreate(q.trim(), filled, multi)}
        >
          <Text style={s.pollBtnTxt}>Create poll</Text>
        </TouchableOpacity>
      </View>
    </PopupModal>
  );
}

const s = themed((C) => ({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    paddingHorizontal: SPACING.md, paddingBottom: SPACING.md,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  headerBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  headerTitle: { fontSize: 16, fontWeight: '800', color: C.navy },
  headerSub: { fontSize: 12, color: C.green, fontWeight: '600' },
  // "last seen …" is information, not a live-status badge — greyed so it doesn't
  // read as "online" at a glance.
  headerSubIdle: { color: C.slate500, fontWeight: '500' },
  iconBtn: {
    width: 40, height: 40, borderRadius: RADIUS.lg, backgroundColor: COLORS.card,
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },

  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.screen,
    paddingVertical: SPACING.screen, paddingHorizontal: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  menuTxt: { fontSize: 15.5, fontWeight: '700', color: C.ink },

  // Contextual header while a message is selected.
  selHeader: { backgroundColor: COLORS.card },
  // The normal header is hidden rather than unmounted while a message is
  // selected, so the message list below never shifts slot and keeps its scroll.
  hidden: { display: 'none' },
  selBtn: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs },
  selectedRow: { backgroundColor: 'rgba(30,64,175,0.07)' },
  // Search hit, flashed for a couple of seconds after jumping to it.
  hitRow: { backgroundColor: 'rgba(217,119,6,0.14)' },

  searchField: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: C.slate50, borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.lg, height: 42, marginLeft: SPACING.sm,
  },
  searchInput: { flex: 1, fontSize: 14.5, color: C.ink, paddingVertical: 0 },
  hitItem: {
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  hitHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hitWho: { flex: 1, fontSize: 13.5, fontWeight: '800', color: C.primary },
  hitWhen: { fontSize: 11.5, color: C.slate400 },
  hitBody: { fontSize: 14, color: C.slate700, marginTop: 3, lineHeight: 19 },

  // Reaction strip above the selected bubble.
  reactStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    alignSelf: 'flex-start', marginHorizontal: SPACING.md, marginBottom: 4,
    backgroundColor: COLORS.card, borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.xs, paddingVertical: 3, ...SHADOW,
  },
  reactStripMine: { alignSelf: 'flex-end' },
  reactStripTheirs: { alignSelf: 'flex-start' },
  reactPickBtn: { paddingHorizontal: 5, paddingVertical: 3, borderRadius: RADIUS.pill },
  reactPickBtnOn: { backgroundColor: COLORS.tintBg },
  reactPickEmoji: { fontSize: 23 },
  reactPlus: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.slate100,
    alignItems: 'center', justifyContent: 'center', marginLeft: 2,
  },

  emojiWrap: { flexDirection: 'row', flexWrap: 'wrap', padding: SPACING.md },
  emojiCell: { width: '12.5%', alignItems: 'center', paddingVertical: 9 },
  emojiBig: { fontSize: 26 },

  pinBar: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.tintBg, borderLeftWidth: 3, borderLeftColor: C.primary,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
  },
  pinTxt: { fontSize: 13, color: C.slate700, fontWeight: '600' },
  pinLeft: { fontSize: 10.5, color: C.slate400, marginTop: 1 },
  // SPACING.xl to line up with PopupModal's header inset.
  pinRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.md,
    paddingVertical: 11, paddingHorizontal: SPACING.xl,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  pinRowAuthor: { fontSize: 12.5, fontWeight: '800', color: C.primary },
  pinRowBody: { fontSize: 13.5, color: C.slate700, marginTop: 1 },
  pinCount: { fontSize: 11.5, fontWeight: '800', color: C.primary },

  editWrap: { borderTopWidth: 1, borderTopColor: C.line, backgroundColor: COLORS.card, paddingBottom: Platform.OS === 'ios' ? 22 : SPACING.sm },
  editHead: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SPACING.screen, paddingTop: SPACING.md, paddingBottom: SPACING.xs,
  },
  editTitle: { flex: 1, fontSize: 12.5, fontWeight: '800', color: C.primary },
  editRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm, paddingHorizontal: SPACING.md },
  editInput: {
    flex: 1, maxHeight: 120, minHeight: 40, backgroundColor: C.slate50,
    borderRadius: RADIUS.sheet, paddingHorizontal: SPACING.screen, paddingVertical: 10,
    fontSize: 15, color: C.ink,
  },
  editSend: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },

  fwdRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  fwdName: { flex: 1, fontSize: 15, fontWeight: '700', color: C.ink },
  fwdEmpty: { fontSize: 13.5, color: C.slate500, padding: SPACING.xl, textAlign: 'center' },

  // PopupModal has no padding of its own, so the dialog body supplies it.
  pollBody: { paddingHorizontal: SPACING.xl, paddingTop: SPACING.sm },
  pollOptRowEdit: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.sm,
  },
  pollFoot: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md },
  pollInput: {
    backgroundColor: C.slate50, borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.line,
    paddingHorizontal: SPACING.screen, height: 46, fontSize: 15, color: C.ink, marginBottom: SPACING.sm,
  },
  pollAdd: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: SPACING.sm },
  pollAddTxt: { fontSize: 14, fontWeight: '700', color: C.primary },
  pollMulti: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.md },
  pollMultiTxt: { fontSize: 14.5, color: C.ink, fontWeight: '600' },
  pollBtn: {
    height: 50, borderRadius: RADIUS.lg, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: SPACING.sm, marginBottom: SPACING.lg,
  },
  pollBtnTxt: { color: COLORS.onPrimary, fontSize: 15.5, fontWeight: '800' },

  opening: {
    position: 'absolute', alignSelf: 'center', bottom: 120,
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: 'rgba(15,23,42,0.88)', borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm,
  },
  openingTxt: { color: COLORS.onPrimary, fontSize: 13, fontWeight: '700' },

  // Jump-to-latest, shown only once the user has scrolled away from the bottom.
  scrollDown: {
    position: 'absolute', right: SPACING.screen,
    width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.card,
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingRight: SPACING.xs },
  stepTxt: { fontSize: 12.5, fontWeight: '800', color: C.slate500, minWidth: 34, textAlign: 'center' },

  infoGroup: { paddingHorizontal: SPACING.xl, paddingTop: SPACING.screen, paddingBottom: SPACING.sm },
  infoHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  infoLabel: { flex: 1, fontSize: 13, fontWeight: '800', color: C.muted },
  infoCount: { fontSize: 12.5, fontWeight: '800', color: C.slate500 },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  infoName: { flex: 1, fontSize: 14.5, fontWeight: '600', color: C.ink },
  infoAt: { fontSize: 12, color: C.faint, fontWeight: '600' },
  infoEmpty: { fontSize: 13, color: C.faint, paddingVertical: SPACING.sm },

  askRow: {
    paddingHorizontal: SPACING.xl, paddingVertical: SPACING.screen,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  askTxt: { fontSize: 15, color: C.ink, fontWeight: '700' },
  askSub: { fontSize: 12, color: C.slate500, marginTop: 2, lineHeight: 16 },
  askNote: { fontSize: 11.5, color: C.faint, padding: SPACING.xl, lineHeight: 16 },

  dayWrap: { alignItems: 'center', marginVertical: SPACING.md },
  dayTxt: {
    fontSize: 11.5, fontWeight: '700', color: C.slate500,
    backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.lg, paddingVertical: 4, overflow: 'hidden',
  },
}));
