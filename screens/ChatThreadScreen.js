// CHAT THREAD — one conversation: history, live incoming, send, receipts.
//
// The list is INVERTED. Messages are held newest-first in state and FlatList
// draws bottom-up, which is what makes "stick to the latest message" free and
// makes loading older pages append rather than prepend (no scroll jumping).
// The server returns ascending by id, so every fetch is reversed on the way in.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Platform, ActivityIndicator, Alert, Linking, TextInput, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { COLORS, SHADOW, RADIUS, SPACING, TOP } from '../theme';
import { Screen, Loader, EmptyState, Avatar, Sheet, MenuPopup, PopupModal } from '../components/ui';
import MessageBubble from '../components/chat/MessageBubble';
import Composer from '../components/chat/Composer';
import MediaViewer from '../components/chat/MediaViewer';
import MediaPreview from '../components/chat/MediaPreview';
import AttachSheet from '../components/chat/AttachSheet';
import VoiceRecorder from '../components/chat/VoiceRecorder';
import CameraCaptureModal from '../components/CameraCaptureModal';
import * as chat from '../services/chat';
import realtime from '../services/chatRealtime';
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

// /chat/pin_message accepts only these four; anything else is rejected.
const PIN_DAYS = [
  { days: 1, label: '24 hours' },
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
];

// hours 0 = until turned off, which is what the server treats as "forever".
const MUTE_FOR = [
  { hours: 8, label: '8 hours', confirm: 'for 8 hours' },
  { hours: 24, label: '1 day', confirm: 'for 1 day' },
  { hours: 168, label: '1 week', confirm: 'for a week' },
  { hours: 0, label: 'Until I turn it off', confirm: 'until you turn them back on' },
];

export default function ChatThreadScreen({
  conversation, onBack, onOpenInfo, onOpenSearch, onOpenMedia, onOpenStarred,
}) {
  const convId = conversation?.id;
  const [messages, setMessages] = useState([]);   // newest-first (inverted list)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);   // no older pages left
  const [replyTo, setReplyTo] = useState(null);
  const [typingName, setTypingName] = useState(null);
  const [viewerMsg, setViewerMsg] = useState(null);   // media open full-screen
  const [menuOpen, setMenuOpen] = useState(false);    // header ⋮ menu
  const [msgMenu, setMsgMenu] = useState(null);       // long-pressed message
  const [editing, setEditing] = useState(null);       // message being edited
  const [forwarding, setForwarding] = useState(null); // message being forwarded
  const [pinned, setPinned] = useState([]);           // pinned banner
  const [pollOpen, setPollOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [opening, setOpening] = useState(null);   // message id being fetched to open
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

  // ── initial load ───────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setError(null);
    try {
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
  }, [convId]);

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false); })(); }, [load]);

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

  // ── send ───────────────────────────────────────────────────────────────────
  const send = useCallback(async (body, linkCard) => {
    setSending(true);
    const replyId = replyTo?.id;
    setReplyTo(null);
    try {
      const msg = await chat.sendText(convId, body, { replyToId: replyId });
      seenIds.current.add(msg.id);
      realtime.noteMessageId(msg.id);
      // The server always returns link:null here — it scrapes in a background
      // thread after responding. Carry the composer's card over so the preview
      // is there the instant the bubble appears; the periodic refetch later
      // replaces it with the server's own copy.
      setMessages((prev) => [{ ...msg, link: msg.link || linkCard || null }, ...prev]);
    } catch (e) {
      // The server refuses sends for real reasons (blocked, admin-only group), so
      // surface the message rather than silently dropping the text.
      Alert.alert('Not sent', e?.message || 'Could not send the message.');
    } finally {
      setSending(false);
    }
  }, [convId, replyTo]);

  const typing = useCallback((on) => { chat.sendTyping(convId, on); }, [convId]);

  // ── attachments ────────────────────────────────────────────────────────────
  const pushMedia = useCallback(async (opts) => {
    setSending(true);
    try {
      const msg = await chat.sendMedia(convId, opts);
      seenIds.current.add(msg.id);
      realtime.noteMessageId(msg.id);
      setMessages((prev) => [msg, ...prev]);
    } catch (e) {
      Alert.alert('Not sent', e?.message || 'Could not send the attachment.');
    } finally {
      setSending(false);
    }
  }, [convId]);

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
  // It calls onCapture with a plain URI string — no base64 — so read the file.
  const onCaptured = useCallback(async (uri) => {
    setCameraOpen(false);
    if (!uri) return;
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      await pushMedia({ kind: 'image', fileB64: b64, fileName: 'photo.jpg', mimetype: 'image/jpeg' });
    } catch (e) {
      Alert.alert('Not sent', e?.message || 'Could not read the photo.');
    }
  }, [pushMedia]);

  // The mic swaps the composer for the recorder; the recorder hands back the
  // finished take, which uploads like any other attachment.
  const onVoice = useCallback(() => setRecording(true), []);

  const sendVoice = useCallback(async ({ fileB64, fileName, mimetype, duration }) => {
    setRecording(false);
    await pushMedia({ kind: 'audio', fileB64, fileName, mimetype, duration });
  }, [pushMedia]);

  const attachItems = [
    { key: 'gallery', label: 'Gallery', icon: 'image', lib: 'mc', bg: '#EDE9FE', fg: '#7C3AED', onPress: () => pickGallery(['images', 'videos']) },
    { key: 'camera', label: 'Camera', icon: 'camera', lib: 'mc', bg: '#FCE7F3', fg: '#DB2777', onPress: () => setCameraOpen(true) },
    { key: 'document', label: 'Document', icon: 'file-document', lib: 'mc', bg: '#DBEAFE', fg: '#2563EB', onPress: pickDocument },
    { key: 'poll', label: 'Poll', icon: 'poll', lib: 'mc', bg: '#CFFAFE', fg: '#0891B2', onPress: () => setPollOpen(true) },
    { key: 'meet', label: 'Meeting', icon: 'video', lib: 'mc', bg: '#DCFCE7', fg: '#16A34A', onPress: () => headerAction('meet') },
    { key: 'audio', label: 'Audio', icon: 'music-note', lib: 'mc', bg: '#FFEDD5', fg: '#EA580C', onPress: onVoice },
  ];

  // ── message actions ────────────────────────────────────────────────────────
  // Applied optimistically where the server echoes the updated message back, and
  // by refetch where it doesn't (forward tells you nothing; delete-for-me returns
  // only a removal flag and is never broadcast).
  const replaceMsg = (m) => setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));

  const act = useCallback(async (kind, m) => {
    setMsgMenu(null);
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
        const i = await chat.messageInfo(m.id);
        Alert.alert(
          'Message info',
          `Delivered to ${i.delivered.length}\nRead by ${i.read.length}` +
          (i.isGroup ? ` of ${i.memberCount}` : ''),
        );
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

  // The server only allows editing your own message within 15 minutes, and only
  // the author may delete for everyone — mirror both so nobody taps into an error.
  const canEdit = (m) => m.mine && !m.deleted && m.kind === 'text'
    && Date.now() - new Date(m.created).getTime() < 15 * 60 * 1000;

  // Tapping an existing chip toggles your own reaction off (the server treats an
  // empty emoji as "remove"), which is what tapping your own chip should do.
  const react = useCallback(async (m, emoji) => {
    setMsgMenu(null);
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
    if (m.kind === 'image') { setViewerMsg(m); return; }
    setOpening(m.id);
    try {
      await openAttachment(m);
    } catch (e) {
      Alert.alert('Could not open', e?.message || 'The file could not be opened.');
    } finally {
      setOpening(null);
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
      if (kind === 'search') { onOpenSearch?.(); return; }
      if (kind === 'media') { onOpenMedia?.(); return; }
      if (kind === 'starred') { onOpenStarred?.(); return; }
      if (kind === 'meet') {
        // Gated server-side (admin-only by default, and by scope) — surface the
        // refusal rather than failing silently.
        const m = await chat.createMeet(convId);
        seenIds.current.add(m.id);
        realtime.noteMessageId(m.id);
        setMessages((prev) => [m, ...prev]);
        return;
      }
      if (kind === 'mute') { setMuteAsk(true); return; }
      if (kind === 'markUnread') { await chat.markUnread(convId); onBack?.(); return; }
      if (kind === 'clear') {
        Alert.alert('Clear chat?', 'Messages will be hidden for you only.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Clear',
            style: 'destructive',
            onPress: async () => {
              try { await chat.clearChat(convId); setMessages([]); seenIds.current = new Set(); }
              catch (e) { Alert.alert('Failed', e?.message || 'Please try again.'); }
            },
          },
        ]);
      }
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Please try again.');
    }
  }, [convId, onOpenInfo, onOpenSearch, onOpenMedia, onOpenStarred, onBack]);

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
    return (
      <View>
        {newDay && !!item.created && (
          <View style={s.dayWrap}><Text style={s.dayTxt}>{dayLabel(item.created)}</Text></View>
        )}
        <MessageBubble
          msg={toBubble(item)}
          showAuthor={showAuthor}
          onLongPress={() => setMsgMenu(item)}
          // Only offer the viewer when the server actually served media —
          // has_media is false for deleted and burned view-once messages.
          onMediaPress={item.hasMedia ? () => openMedia(item) : undefined}
          onReact={(emoji) => react(item, emoji)}
          onVote={vote}
          onMeet={(url) => Linking.openURL(url).catch(() => Alert.alert('Could not open', url))}
          onOpenLink={(url) => Linking.openURL(url).catch(() => Alert.alert('Could not open', url))}
        />
      </View>
    );
  };

  return (
    <Screen>
      <View style={[s.header, { paddingTop: TOP }]}>
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
        <TouchableOpacity style={s.pinBar} activeOpacity={0.8} onPress={() => setViewerMsg(null)}>
          <Ionicons name="pin" size={15} color={COLORS.primary} />
          <Text style={s.pinTxt} numberOfLines={1}>
            {pinned[0].body || pinned[0].fileName || 'Pinned message'}
          </Text>
          {pinned.length > 1 && <Text style={s.pinCount}>+{pinned.length - 1}</Text>}
        </TouchableOpacity>
      )}

      {/* paddingBottom, not KeyboardAvoidingView — see utils/useKeyboardHeight.
          Keyboard UP: pad by keyboard + inset. Android reports the keyboard
          height measured from ABOVE the navigation bar under edge-to-edge, so
          taking max() left the composer short by exactly the nav-bar height and
          it hid behind the keyboard's toolbar row.
          Keyboard DOWN: just the inset, to clear the nav/gesture bar. */}
      <View style={{ flex: 1, paddingBottom: kb > 0 ? kb + insets.bottom : insets.bottom }}>
        {loading ? (
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
            contentContainerStyle={{ paddingVertical: SPACING.md, flexGrow: 1 }}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.4}
            keyboardDismissMode="interactive"
            // Inverted list: offset 0 IS the newest message, so "scrolled away
            // from the bottom" means a positive offset.
            onScroll={(e) => setAtBottom(e.nativeEvent.contentOffset.y < 80)}
            scrollEventThrottle={64}
            // Inverted: the "footer" renders at the TOP, which is where an older-page
            // spinner belongs.
            ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 14 }} color={COLORS.primary} /> : null}
            ListEmptyComponent={
              <EmptyState icon="chatbubble-ellipses-outline" title="No messages yet" sub="Say hello." />
            }
          />
        )}

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

        {recording ? (
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
            sending={sending}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            emojiOpen={emojiOpen}
            onToggleEmoji={setEmojiOpen}
            panelHeight={lastKb.current}
          />
        )}
      </View>

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
          { icon: 'videocam-outline', label: 'Start a meeting', onPress: () => headerAction('meet') },
          { icon: 'notifications-off-outline', label: 'Mute notifications', onPress: () => headerAction('mute') },
          { icon: 'mail-unread-outline', label: 'Mark as unread', onPress: () => headerAction('markUnread') },
          { icon: 'trash-outline', label: 'Clear chat', tone: 'danger', onPress: () => headerAction('clear') },
        ]}
      />

      {/* Long-press on a message */}
      <Sheet visible={!!msgMenu} onClose={() => setMsgMenu(null)} title="Message">
        {!!msgMenu && !msgMenu.deleted && (
          <View style={s.reactPickRow}>
            {QUICK_REACTIONS.map((e) => (
              <TouchableOpacity key={e} style={s.reactPick} onPress={() => react(msgMenu, e)} activeOpacity={0.7}>
                <Text style={s.reactPickTxt}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <ScrollView style={{ maxHeight: 360 }}>
          {!!msgMenu && !msgMenu.deleted && (
            <>
              <MenuItem icon="arrow-undo-outline" label="Reply" onPress={() => act('reply', msgMenu)} />
              <MenuItem icon="arrow-redo-outline" label="Forward" onPress={() => act('forward', msgMenu)} />
              <MenuItem
                icon={msgMenu.starred ? 'star' : 'star-outline'}
                label={msgMenu.starred ? 'Unstar' : 'Star'}
                onPress={() => act('star', msgMenu)}
              />
              <MenuItem
                icon={msgMenu.pinned ? 'pin' : 'pin-outline'}
                label={msgMenu.pinned ? 'Unpin' : 'Pin'}
                onPress={() => act('pin', msgMenu)}
              />
              {canEdit(msgMenu) && (
                <MenuItem icon="create-outline" label="Edit" onPress={() => act('edit', msgMenu)} />
              )}
              {msgMenu.mine && <MenuItem icon="checkmark-done-outline" label="Info" onPress={() => act('info', msgMenu)} />}
            </>
          )}
          <MenuItem icon="eye-off-outline" label="Delete for me" tone="danger" onPress={() => act('deleteMe', msgMenu)} />
          {!!msgMenu?.mine && !msgMenu?.deleted && (
            <MenuItem icon="trash-outline" label="Delete for everyone" tone="danger" onPress={() => act('deleteAll', msgMenu)} />
          )}
        </ScrollView>
      </Sheet>

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
          <ActivityIndicator color="#fff" size="small" />
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
      <PopupModal visible={muteAsk} onClose={() => setMuteAsk(false)} title="Mute notifications">
        {MUTE_FOR.map((m) => (
          <TouchableOpacity
            key={m.label}
            style={s.askRow}
            activeOpacity={0.75}
            onPress={async () => {
              setMuteAsk(false);
              try {
                await chat.muteConversation(convId, true, m.hours);
                Alert.alert('Muted', `Notifications are off ${m.confirm}.`);
              } catch (e) { Alert.alert('Failed', e?.message || 'Could not mute.'); }
            }}
          >
            <Text style={s.askTxt}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </PopupModal>

      <MediaPreview
        visible={!!previewItems?.length}
        items={previewItems || []}
        sending={sending}
        onCancel={() => setPreviewItems(null)}
        onSend={sendReviewed}
      />

      <MediaViewer visible={!!viewerMsg} message={viewerMsg} onClose={() => setViewerMsg(null)} />
    </Screen>
  );
}

// One row in either sheet.
function MenuItem({ icon, label, onPress, tone }) {
  return (
    <TouchableOpacity style={s.menuItem} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={20} color={tone === 'danger' ? COLORS.red : COLORS.primary} />
      <Text style={[s.menuTxt, tone === 'danger' && { color: COLORS.red }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Replaces the composer while an edit is in flight. Seeded with the current body
// so the user amends rather than retypes.
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
          <Ionicons name="checkmark" size={20} color="#fff" />
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
    <Sheet visible={visible} onClose={onClose} title="Create poll">
      <ScrollView style={{ maxHeight: 400 }}>
        <TextInput style={s.pollInput} value={q} onChangeText={setQ} placeholder="Question" placeholderTextColor={COLORS.faint} />
        {opts.map((o, i) => (
          <TextInput
            key={i} style={s.pollInput} value={o} onChangeText={(v) => setOpt(i, v)}
            placeholder={`Option ${i + 1}`} placeholderTextColor={COLORS.faint}
          />
        ))}
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
        <TouchableOpacity
          style={[s.pollBtn, !ready && { backgroundColor: COLORS.slate400 }]}
          disabled={!ready}
          onPress={() => onCreate(q.trim(), filled, multi)}
        >
          <Text style={s.pollBtnTxt}>Create poll</Text>
        </TouchableOpacity>
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    paddingHorizontal: SPACING.md, paddingBottom: SPACING.md,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderBottomWidth: 1, borderBottomColor: COLORS.line,
  },
  headerBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  headerTitle: { fontSize: 16, fontWeight: '800', color: COLORS.navy },
  headerSub: { fontSize: 12, color: COLORS.green, fontWeight: '600' },
  // "last seen …" is information, not a live-status badge — greyed so it doesn't
  // read as "online" at a glance.
  headerSubIdle: { color: COLORS.slate500, fontWeight: '500' },
  iconBtn: {
    width: 40, height: 40, borderRadius: RADIUS.lg, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },

  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.screen,
    paddingVertical: SPACING.screen, paddingHorizontal: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line,
  },
  menuTxt: { fontSize: 15.5, fontWeight: '700', color: COLORS.ink },

  reactPickRow: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    paddingVertical: SPACING.md, marginBottom: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line,
  },
  reactPick: { padding: SPACING.xs },
  reactPickTxt: { fontSize: 26 },

  pinBar: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: '#EAF1FE', borderLeftWidth: 3, borderLeftColor: COLORS.primary,
    paddingHorizontal: SPACING.screen, paddingVertical: SPACING.md,
  },
  pinTxt: { flex: 1, fontSize: 13, color: COLORS.slate700, fontWeight: '600' },
  pinCount: { fontSize: 11.5, fontWeight: '800', color: COLORS.primary },

  editWrap: { borderTopWidth: 1, borderTopColor: COLORS.line, backgroundColor: '#fff', paddingBottom: Platform.OS === 'ios' ? 22 : SPACING.sm },
  editHead: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SPACING.screen, paddingTop: SPACING.md, paddingBottom: SPACING.xs,
  },
  editTitle: { flex: 1, fontSize: 12.5, fontWeight: '800', color: COLORS.primary },
  editRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm, paddingHorizontal: SPACING.md },
  editInput: {
    flex: 1, maxHeight: 120, minHeight: 40, backgroundColor: COLORS.slate50,
    borderRadius: RADIUS.sheet, paddingHorizontal: SPACING.screen, paddingVertical: 10,
    fontSize: 15, color: COLORS.ink,
  },
  editSend: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },

  fwdRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.lg,
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line,
  },
  fwdName: { flex: 1, fontSize: 15, fontWeight: '700', color: COLORS.ink },
  fwdEmpty: { fontSize: 13.5, color: COLORS.slate500, padding: SPACING.xl, textAlign: 'center' },

  pollInput: {
    backgroundColor: COLORS.slate50, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.line,
    paddingHorizontal: SPACING.screen, height: 46, fontSize: 15, color: COLORS.ink, marginBottom: SPACING.sm,
  },
  pollAdd: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: SPACING.sm },
  pollAddTxt: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  pollMulti: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.md },
  pollMultiTxt: { fontSize: 14.5, color: COLORS.ink, fontWeight: '600' },
  pollBtn: {
    height: 50, borderRadius: RADIUS.lg, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: SPACING.sm, marginBottom: SPACING.lg,
  },
  pollBtnTxt: { color: '#fff', fontSize: 15.5, fontWeight: '800' },

  opening: {
    position: 'absolute', alignSelf: 'center', bottom: 120,
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: 'rgba(15,23,42,0.88)', borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm,
  },
  openingTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // Jump-to-latest, shown only once the user has scrolled away from the bottom.
  scrollDown: {
    position: 'absolute', right: SPACING.screen,
    width: 42, height: 42, borderRadius: 21, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW,
  },

  askRow: {
    paddingHorizontal: SPACING.xl, paddingVertical: SPACING.screen,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line,
  },
  askTxt: { fontSize: 15, color: COLORS.ink, fontWeight: '600' },
  askNote: { fontSize: 11.5, color: COLORS.faint, padding: SPACING.xl, lineHeight: 16 },

  dayWrap: { alignItems: 'center', marginVertical: SPACING.md },
  dayTxt: {
    fontSize: 11.5, fontWeight: '700', color: COLORS.slate500,
    backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.lg, paddingVertical: 4, overflow: 'hidden',
  },
});
