// Composer — the WhatsApp-shaped input bar.
//
//   ┌──────────────────────────────────────────┐  ╭───╮
//   │ 😊   Message              📎   📷        │  │ ➤ │
//   └──────────────────────────────────────────┘  ╰───╯
//
// Emoji, field, attach and camera share one rounded pill; the round button sits
// outside it and swaps between mic (nothing typed) and send (something typed),
// exactly as WhatsApp does.
//
// Typing notifications are throttled to one every 2.5s — the cadence the
// module's own web client uses — because /chat/typing stores nothing and is pure
// fan-out, so one per keystroke would be wasted traffic. A `false` is sent on
// send and on blur; receivers additionally self-expire after 4s, since the
// server sets no expiry of its own.
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, Image, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  ScrollView, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as chat from '../../services/chat';
import { COLORS, RADIUS, SPACING } from '../../theme';

const TYPING_THROTTLE_MS = 2500;

// A small built-in set, grouped the way a picker would be. React Native has no
// emoji keyboard of its own and a full picker is a native dependency, so these
// insert straight into the field — enough for reactions-in-text without a rebuild.
const EMOJI = [
  '😀', '😂', '🙂', '😍', '😎', '🤔', '😴', '🙄',
  '😢', '😭', '😡', '🥳', '🤝', '👍', '👎', '👏',
  '🙏', '💪', '🔥', '✨', '🎉', '❤️', '💯', '✅',
  '❌', '⚠️', '📌', '📎', '📷', '🎧', '⏰', '🚀',
];

export default function Composer({
  onSend, onAttach, onCamera, onVoice, onTyping,
  sending, replyTo, onCancelReply, disabled, disabledReason,
  emojiOpen, onToggleEmoji, panelHeight = 280,
}) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);       // compose-time link card
  const [previewBusy, setPreviewBusy] = useState(false);
  const lastTypingRef = useRef(0);
  const inputRef = useRef(null);
  const previewTimer = useRef(null);
  const previewFor = useRef(null);   // the URL the current preview belongs to

  useEffect(() => () => clearTimeout(previewTimer.current), []);

  // Replying focuses the field — the user's next action is always to type.
  useEffect(() => { if (replyTo) inputRef.current?.focus(); }, [replyTo]);

  // Emoji behaves like a second keyboard: opening it dismisses the system one so
  // the two never stack, and tapping the field again brings the keyboard back.
  const toggleEmoji = () => {
    if (emojiOpen) {
      onToggleEmoji?.(false);
      inputRef.current?.focus();
    } else {
      Keyboard.dismiss();
      onToggleEmoji?.(true);
    }
  };

  const change = (t) => {
    setText(t);
    if (onTyping) {
      const now = Date.now();
      if (now - lastTypingRef.current > TYPING_THROTTLE_MS) {
        lastTypingRef.current = now;
        onTyping(true);
      }
    }

    // Compose-time link preview. The server scrapes synchronously with a 6s
    // timeout, so this is debounced hard and only fires when the URL actually
    // changes — never per keystroke.
    const url = chat.firstUrl(t);
    if (!url) { setPreview(null); previewFor.current = null; clearTimeout(previewTimer.current); return; }
    if (url === previewFor.current) return;
    previewFor.current = url;
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      setPreviewBusy(true);
      const p = await chat.fetchLinkPreview(url);
      // A newer URL may have won the race while this was in flight.
      if (previewFor.current === url) setPreview(p);
      setPreviewBusy(false);
    }, 700);
  };

  const send = () => {
    const body = text.trim();
    if (!body || sending) return;
    // Hand the already-scraped preview over with the message. The server's own
    // scrape runs in a background thread AFTER /chat/send returns, so without
    // this the card the user is looking at would vanish on send and only
    // reappear a poll or two later.
    const card = preview;
    setText('');
    setPreview(null);
    previewFor.current = null;
    clearTimeout(previewTimer.current);
    lastTypingRef.current = 0;
    onTyping?.(false);
    onSend(body, card);
  };

  const hasText = !!text.trim();

  if (disabled) {
    return (
      <View style={s.disabled}>
        <Ionicons name="lock-closed" size={14} color={COLORS.slate500} />
        <Text style={s.disabledTxt}>{disabledReason || "You can't send messages here."}</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      {!!replyTo && (
        <View style={s.replyBar}>
          <View style={s.replyBody}>
            <Text style={s.replyAuthor} numberOfLines={1}>{replyTo.authorName}</Text>
            <Text style={s.replyPreview} numberOfLines={1}>
              {replyTo.body || replyTo.fileName || 'Attachment'}
            </Text>
          </View>
          <TouchableOpacity onPress={onCancelReply} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={18} color={COLORS.slate500} />
          </TouchableOpacity>
        </View>
      )}

      {/* Preview of the pasted link, before sending. */}
      {(preview || previewBusy) && (
        <View style={s.preview}>
          {previewBusy && !preview ? (
            <View style={[s.previewBody, s.previewLoading]}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={s.previewDesc}>Loading preview…</Text>
            </View>
          ) : (
            <>
              {!!preview.image && <Image source={{ uri: preview.image }} style={s.previewImg} />}
              <View style={s.previewBody}>
                {!!preview.title && <Text style={s.previewTitle} numberOfLines={2}>{preview.title}</Text>}
                {!!preview.desc && <Text style={s.previewDesc} numberOfLines={2}>{preview.desc}</Text>}
                <Text style={s.previewUrl} numberOfLines={1}>{preview.url}</Text>
              </View>
              <TouchableOpacity
                onPress={() => { setPreview(null); previewFor.current = null; }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={s.previewClose}
              >
                <Ionicons name="close" size={17} color={COLORS.slate500} />
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      <View style={s.bar}>
        <View style={s.pill}>
          <TouchableOpacity
            onPress={toggleEmoji}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={s.pillBtn}
          >
            <Ionicons
              name={emojiOpen ? 'keypad-outline' : 'happy-outline'}
              size={24} color={COLORS.slate500}
            />
          </TouchableOpacity>

          <TextInput
            ref={inputRef}
            style={s.input}
            value={text}
            onChangeText={change}
            onBlur={() => onTyping?.(false)}
            // Tapping the field returns to the system keyboard.
            onFocus={() => onToggleEmoji?.(false)}
            placeholder="Message"
            placeholderTextColor={COLORS.faint}
            multiline
            maxLength={4000}
          />

          <TouchableOpacity
            onPress={onAttach}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            style={s.pillBtn}
          >
            {/* Rotated so the clip reads as a paperclip rather than a link. */}
            <Ionicons name="attach" size={24} color={COLORS.slate500} style={{ transform: [{ rotate: '45deg' }] }} />
          </TouchableOpacity>

          {/* The camera shortcut hides once there is text, as it does in WhatsApp —
              at that point the row is about sending words, not taking a photo. */}
          {!hasText && (
            <TouchableOpacity
              onPress={onCamera}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              style={s.pillBtn}
            >
              <Ionicons name="camera-outline" size={23} color={COLORS.slate500} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          onPress={hasText ? send : onVoice}
          disabled={sending}
          style={s.round}
          activeOpacity={0.85}
        >
          {sending
            ? <ActivityIndicator color="#fff" size="small" />
            : <Ionicons name={hasText ? 'send' : 'mic'} size={hasText ? 19 : 22} color="#fff" />}
        </TouchableOpacity>
      </View>

      {/* Emoji panel sits UNDER the composer at the keyboard's own height, so
          swapping between them doesn't move the message list. */}
      {emojiOpen && (
        <View style={[s.emojiPanel, { height: panelHeight }]}>
          <ScrollView>
            <View style={s.emojiGrid}>
              {EMOJI.map((e) => (
                <TouchableOpacity
                  key={e}
                  style={s.emojiCell}
                  onPress={() => setText((t) => t + e)}
                  activeOpacity={0.6}
                >
                  <Text style={s.emoji}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          <TouchableOpacity
            style={s.emojiBack}
            onPress={() => setText((t) => t.slice(0, -2))}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="backspace-outline" size={22} color={COLORS.slate500} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: 'transparent', paddingBottom: SPACING.sm },
  bar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm,
    paddingHorizontal: SPACING.sm, paddingTop: SPACING.sm,
  },
  // The pill floats on the chat background rather than sitting on a bar, which
  // is what makes the WhatsApp composer feel light.
  pill: {
    flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.xs,
    backgroundColor: '#fff', borderRadius: RADIUS.sheet,
    paddingHorizontal: SPACING.md, paddingVertical: 5, minHeight: 48,
    shadowColor: '#1e293b', shadowOpacity: 0.06, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  pillBtn: { paddingBottom: 7, paddingHorizontal: 2 },
  input: {
    flex: 1, maxHeight: 120, minHeight: 38,
    paddingHorizontal: SPACING.xs, paddingTop: 9, paddingBottom: 9,
    fontSize: 15.5, color: COLORS.ink,
  },
  round: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },

  preview: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: SPACING.md, marginTop: SPACING.sm,
    backgroundColor: '#fff', borderRadius: RADIUS.md,
    borderLeftWidth: 3, borderLeftColor: COLORS.link,
    overflow: 'hidden',
  },
  previewImg: { width: 56, height: 56, backgroundColor: COLORS.slate100 },
  // Column: title / desc / url stack. The loading row overrides to a row below.
  previewBody: { flex: 1, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: 1 },
  previewLoading: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  previewTitle: { fontSize: 12.5, fontWeight: '800', color: COLORS.ink },
  previewDesc: { fontSize: 11.5, color: COLORS.slate500 },
  previewUrl: { fontSize: 10.5, color: COLORS.link },
  previewClose: { padding: SPACING.md },

  replyBar: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    marginHorizontal: SPACING.md, marginTop: SPACING.sm,
    backgroundColor: '#fff', borderRadius: RADIUS.md,
    borderLeftWidth: 3, borderLeftColor: COLORS.primary,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm,
  },
  replyBody: { flex: 1 },
  replyAuthor: { fontSize: 12, fontWeight: '800', color: COLORS.primary },
  replyPreview: { fontSize: 12.5, color: COLORS.slate500 },

  emojiPanel: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: COLORS.line },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingBottom: 44 },
  emojiCell: { width: '12.5%', alignItems: 'center', paddingVertical: 9 },
  emoji: { fontSize: 26 },
  emojiBack: {
    position: 'absolute', right: SPACING.screen, bottom: SPACING.md,
    width: 42, height: 34, borderRadius: RADIUS.md, backgroundColor: COLORS.slate100,
    alignItems: 'center', justifyContent: 'center',
  },

  disabled: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    borderTopWidth: 1, borderTopColor: COLORS.line, backgroundColor: COLORS.slate50,
    paddingVertical: SPACING.screen,
  },
  disabledTxt: { fontSize: 13, color: COLORS.slate500, fontWeight: '600' },
});
