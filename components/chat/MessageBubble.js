// MessageBubble — one message row.
//
// Presentation only: it takes an already-normalised message and renders it. All
// server-shape handling lives in services/chat.js, so this file never needs to
// change when a route's payload changes.
//
// msg: {
//   id, body, mine, authorName, time,        // time = display string, already formatted
//   status,                                   // 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
//   kind,                                     // 'text' | 'image' | 'video' | 'audio' | 'file' | 'system'
//   mediaUri, fileName, fileSize,
//   replyTo: { authorName, preview } | null,
//   edited, deleted, starred, forwarded, isMeet,
//   reactions: [{emoji, count, mine}],
//   poll: { question, multi, options: [{id,text,votes,mine}], total } | null,
// }
import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AudioBubble from './AudioBubble';
import AuthImage from './AuthImage';
import LinkedText from './LinkedText';
import { COLORS, RADIUS, SPACING, themed } from '../../theme';

// Read receipts: single tick sent, double delivered, blue double read. `failed`
// is a retry affordance, not a tick.
function Ticks({ status }) {
  if (status === 'sending') return <Ionicons name="time-outline" size={13} color={COLORS.slate400} />;
  if (status === 'failed') return <Ionicons name="alert-circle" size={13} color={COLORS.red} />;
  if (status === 'sent') return <Ionicons name="checkmark" size={14} color={COLORS.slate400} />;
  const read = status === 'read';
  return <Ionicons name="checkmark-done" size={14} color={read ? COLORS.readTick : COLORS.slate400} />;
}

// A system line (X added Y, disappearing messages on…) is centred and ownerless.
function SystemLine({ body }) {
  return (
    <View style={s.systemWrap}>
      <Text style={s.systemTxt}>{body}</Text>
    </View>
  );
}

// Grouped reaction chips under the bubble. `mine` outlines the chip so you can
// see at a glance which one you added.
function Reactions({ list, mine, onPress }) {
  if (!list?.length) return null;
  return (
    <View style={[s.reactRow, mine ? { justifyContent: 'flex-end' } : null]}>
      {list.map((r) => (
        <TouchableOpacity
          key={r.emoji}
          style={[s.reactChip, r.mine && s.reactChipMine]}
          onPress={() => onPress?.(r.emoji)}
          activeOpacity={0.75}
        >
          <Text style={s.reactEmoji}>{r.emoji}</Text>
          {r.count > 1 && <Text style={s.reactCount}>{r.count}</Text>}
        </TouchableOpacity>
      ))}
    </View>
  );
}

// A poll rendered inside the bubble. Percentages are of DISTINCT VOTERS (the
// server's `total`), not of votes — a multi-choice poll can exceed 100% summed.
function Poll({ poll, onVote }) {
  const total = poll.total || 0;
  return (
    <View style={s.poll}>
      <Text style={s.pollQ}>{poll.question}</Text>
      {(poll.options || []).map((o) => {
        const pct = total ? Math.round((o.votes / total) * 100) : 0;
        return (
          <TouchableOpacity key={o.id} style={s.pollOpt} onPress={() => onVote?.(o.id)} activeOpacity={0.8}>
            <View style={[s.pollFill, { width: `${pct}%` }, o.mine && s.pollFillMine]} />
            <View style={s.pollOptRow}>
              <Ionicons
                name={o.mine ? 'checkmark-circle' : 'ellipse-outline'}
                size={16} color={o.mine ? COLORS.primary : COLORS.slate400}
              />
              <Text style={s.pollTxt} numberOfLines={2}>{o.text}</Text>
              <Text style={s.pollPct}>{o.votes}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
      <Text style={s.pollTotal}>
        {total} {total === 1 ? 'vote' : 'votes'}{poll.multi ? ' · pick many' : ''}
      </Text>
    </View>
  );
}

export default function MessageBubble({
  msg, showAuthor, onPress, onLongPress, onMediaPress, onReact, onVote, onMeet, onOpenLink,
  // Active in-chat search term — matches are marked inside the bubble.
  highlight,
}) {
  if (msg.kind === 'system') return <SystemLine body={msg.body} />;

  const mine = !!msg.mine;
  const isMedia = msg.kind === 'image' || msg.kind === 'video';

  return (
    <View style={[s.row, mine ? s.rowMine : s.rowTheirs]}>
      <View style={{ maxWidth: '82%' }}>
      <TouchableOpacity
        activeOpacity={0.9}
        // Media and files have no inner touchable of their own (see below), so
        // the bubble itself carries their tap.
        onPress={
          (isMedia || msg.kind === 'file' || (msg.kind === 'audio' && !msg.mediaUri))
            ? onMediaPress
            : onPress
        }
        onLongPress={onLongPress}
        delayLongPress={250}
        style={[
          s.bubble,
          mine ? s.mine : s.theirs,
          // Media fills the bubble edge-to-edge, so it loses the text padding.
          // A view-once chip is text-shaped, so it keeps it.
          isMedia && !msg.viewOnce && s.bubbleMedia,
        ]}
      >
        {/* Group chats need the sender's name; 1:1 never does. */}
        {showAuthor && !mine && !isMedia && (
          <Text style={s.author} numberOfLines={1}>{msg.authorName}</Text>
        )}

        {msg.forwarded && !msg.deleted && (
          <View style={s.fwd}>
            <Ionicons name="arrow-redo-outline" size={11} color={COLORS.slate400} />
            <Text style={s.fwdTxt}>Forwarded</Text>
          </View>
        )}

        {!!msg.replyTo && (
          <View style={[s.reply, mine ? s.replyMine : s.replyTheirs]}>
            <Text style={s.replyAuthor} numberOfLines={1}>{msg.replyTo.authorName}</Text>
            <Text style={s.replyPreview} numberOfLines={1}>{msg.replyTo.preview}</Text>
          </View>
        )}

        {msg.deleted ? (
          <Text style={[s.body, s.deleted, mine && s.bodyMine]}>
            <Ionicons name="ban-outline" size={13} />  This message was deleted
          </Text>
        ) : msg.viewOnce ? (
          // A view-once photo must NOT render inline — that would defeat the
          // whole point. It shows as a chip; opening it is what consumes it.
          // Once burned (or for the author) the server stops serving the file,
          // so `canViewOnce` is false and this reads "Opened".
          <View style={s.viewOnce}>
            <Ionicons
              name={msg.canViewOnce ? 'eye-outline' : 'eye-off-outline'}
              size={17}
              color={msg.canViewOnce ? (mine ? COLORS.onBubbleMineTint : COLORS.primary) : COLORS.faint}
            />
            <Text style={[s.viewOnceTxt, !msg.canViewOnce && { color: COLORS.faint }, mine && msg.canViewOnce && s.bodyMine]}>
              {msg.canViewOnce
                ? `${msg.kind === 'video' ? 'Video' : 'Photo'} · View once`
                : 'Opened'}
            </Text>
          </View>
        ) : isMedia ? (
          // Plain View, NOT a nested TouchableOpacity: on Android the outer
          // bubble wins the touch responder and an inner onPress never fires —
          // which is exactly why tapping a photo or a document did nothing. The
          // outer touchable now routes to onMediaPress for these kinds.
          <View>
            {/* AuthImage, not Image: the media route needs the session cookie,
                which RN's image pipeline does not carry. See AuthImage. */}
            <AuthImage uri={msg.mediaUri} id={msg.id} mimetype={msg.mimetype} style={s.media} />
            {msg.kind === 'video' && (
              <View style={s.playBadge}><Ionicons name="play" size={22} color={COLORS.onPrimary} /></View>
            )}
            {!!msg.body && <Text style={[s.body, s.mediaCaption, mine && s.bodyMine]}>{msg.body}</Text>}
          </View>
        ) : msg.kind === 'audio' && msg.mediaUri ? (
          <AudioBubble msg={msg.raw || msg} mine={mine} />
        ) : msg.kind === 'file' || msg.kind === 'audio' ? (
          <View style={s.fileRow}>
            <View style={[s.fileChip, mine && s.fileChipMine]}>
              <Ionicons
                name={msg.kind === 'audio' ? 'musical-notes' : 'document-text'}
                size={18} color={mine ? COLORS.onPrimary : COLORS.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.fileName, mine && s.bodyMine]} numberOfLines={1}>{msg.fileName || 'Attachment'}</Text>
              {!!msg.fileSize && <Text style={[s.fileMeta, mine && s.metaMine]}>{msg.fileSize}</Text>}
            </View>
          </View>
        ) : msg.poll ? (
          <Poll poll={msg.poll} onVote={onVote} />
        ) : msg.isMeet ? (
          <TouchableOpacity style={s.meet} activeOpacity={0.85} onPress={() => onMeet?.(msg.body)}>
            <View style={s.meetIcon}><Ionicons name="videocam" size={18} color={COLORS.onPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[s.meetTitle, mine && s.bodyMine]}>Join meeting</Text>
              <Text style={s.meetUrl} numberOfLines={1}>{msg.body}</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <>
            {/* Link preview. The server scrapes OG tags in a background thread
                AFTER /chat/send returns, so `link` is null on the message you get
                back and the card appears on a later poll — never treat its
                absence as "this has no link". */}
            {!!msg.link && (
              <TouchableOpacity
                style={[s.link, mine ? s.linkMine : s.linkTheirs]}
                activeOpacity={0.85}
                onPress={() => onOpenLink?.(msg.link.url)}
                // Forwarded so a long-press starting on the card still selects
                // the message instead of being swallowed by this touchable.
                onLongPress={onLongPress}
                delayLongPress={250}
              >
                {!!msg.link.image && (
                  <Image source={{ uri: msg.link.image }} style={s.linkImg} resizeMode="cover" />
                )}
                <View style={s.linkBody}>
                  {!!msg.link.title && <Text style={s.linkTitle} numberOfLines={2}>{msg.link.title}</Text>}
                  {!!msg.link.desc && <Text style={s.linkDesc} numberOfLines={2}>{msg.link.desc}</Text>}
                  <Text style={s.linkUrl} numberOfLines={1}>{msg.link.url}</Text>
                </View>
              </TouchableOpacity>
            )}
            <LinkedText style={[s.body, mine && s.bodyMine]} onLongPress={onLongPress} highlight={highlight}>
              {msg.body}
            </LinkedText>
          </>
        )}

        {/* Meta sits on one baseline: star, edited marker, time, then ticks. */}
        <View style={s.meta}>
          {msg.starred && <Ionicons name="star" size={11} color={COLORS.amber} />}
          {msg.edited && !msg.deleted && (
            <Text style={[s.metaTxt, mine && s.metaMine]}>edited</Text>
          )}
          <Text style={[s.metaTxt, mine && s.metaMine]}>{msg.time}</Text>
          {mine && !msg.deleted && <Ticks status={msg.status} />}
        </View>
      </TouchableOpacity>
      <Reactions list={msg.reactions} mine={mine} onPress={onReact} />
      </View>
    </View>
  );
}

const s = themed((C) => ({
  row: { paddingHorizontal: SPACING.md, marginBottom: SPACING.xs, flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },

  bubble: {
    borderRadius: RADIUS.xl,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm,
  },
  bubbleMedia: { padding: 4, paddingBottom: SPACING.xs },
  // Tail-side corner squared off, the usual chat cue for who is speaking.
  mine: { backgroundColor: COLORS.bubbleMine, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: COLORS.card, borderBottomLeftRadius: 4 },

  author: { fontSize: 12.5, fontWeight: '800', color: C.primary, marginBottom: 2 },

  reply: {
    borderLeftWidth: 3, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm,
    paddingVertical: 4, marginBottom: SPACING.xs,
  },
  replyMine: { backgroundColor: 'rgba(0,0,0,0.06)', borderLeftColor: C.green },
  replyTheirs: { backgroundColor: C.slate50, borderLeftColor: C.primary },
  replyAuthor: { fontSize: 11.5, fontWeight: '800', color: C.primary },
  replyPreview: { fontSize: 12, color: C.slate500 },

  body: { fontSize: 15, color: C.ink, lineHeight: 20 },
  bodyMine: { color: COLORS.onBubbleMine },
  deleted: { fontStyle: 'italic', color: C.slate500 },

  media: { width: 232, height: 232, borderRadius: RADIUS.lg, backgroundColor: C.slate100 },
  viewOnce: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 3 },
  viewOnceTxt: { fontSize: 14.5, fontWeight: '700', color: C.ink, fontStyle: 'italic' },
  mediaCaption: { paddingHorizontal: SPACING.sm, paddingTop: SPACING.xs },
  playBadge: {
    position: 'absolute', alignSelf: 'center', top: '38%',
    width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },

  fileRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: 2 },
  fileChip: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.tintBg,
    alignItems: 'center', justifyContent: 'center',
  },
  fileChipMine: { backgroundColor: C.green },
  fileName: { fontSize: 14, fontWeight: '700', color: C.ink },
  fileMeta: { fontSize: 11.5, color: C.slate500, marginTop: 1 },

  link: { borderRadius: RADIUS.md, overflow: 'hidden', marginBottom: SPACING.xs, minWidth: 210 },
  linkMine: { backgroundColor: 'rgba(0,0,0,0.06)' },
  linkTheirs: { backgroundColor: C.slate50 },
  linkImg: { width: '100%', height: 118, backgroundColor: C.slate100 },
  linkBody: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: 2 },
  linkTitle: { fontSize: 13.5, fontWeight: '800', color: C.ink },
  linkDesc: { fontSize: 12, color: C.slate500, lineHeight: 16 },
  linkUrl: { fontSize: 11, color: C.link, marginTop: 1 },

  fwd: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 2 },
  fwdTxt: { fontSize: 10.5, color: C.slate400, fontStyle: 'italic', fontWeight: '600' },

  reactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: -4, paddingHorizontal: 4 },
  reactChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: COLORS.card, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: C.line,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  reactChipMine: { borderColor: C.primary, backgroundColor: COLORS.tintBg },
  reactEmoji: { fontSize: 13 },
  reactCount: { fontSize: 11, fontWeight: '800', color: C.slate500 },

  poll: { minWidth: 210, paddingVertical: 2 },
  pollQ: { fontSize: 15, fontWeight: '800', color: C.ink, marginBottom: SPACING.sm },
  pollOpt: {
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.line,
    marginBottom: 6, overflow: 'hidden', backgroundColor: COLORS.card,
  },
  pollFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: COLORS.shellAlt },
  pollFillMine: { backgroundColor: COLORS.pollFillMine },
  pollOptRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 9, paddingVertical: 8 },
  pollTxt: { flex: 1, fontSize: 13.5, color: C.ink, fontWeight: '600' },
  pollPct: { fontSize: 12, fontWeight: '800', color: C.slate500 },
  pollTotal: { fontSize: 11.5, color: C.slate400, marginTop: 2 },

  meet: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: 2, minWidth: 200 },
  meetIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.green,
    alignItems: 'center', justifyContent: 'center',
  },
  meetTitle: { fontSize: 14.5, fontWeight: '800', color: C.ink },
  meetUrl: { fontSize: 11.5, color: C.link, marginTop: 1 },

  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2 },
  metaTxt: { fontSize: 10.5, color: C.slate400 },
  metaMine: { color: COLORS.onBubbleMineMuted },

  systemWrap: { alignItems: 'center', marginVertical: SPACING.sm, paddingHorizontal: 30 },
  systemTxt: {
    fontSize: 11.5, color: C.slate500, textAlign: 'center', fontWeight: '600',
    backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: 5, overflow: 'hidden',
  },
}));
