// 369Chats API client — the /chat/* JSON routes of the chats_369 Odoo module.
//
// Every route is type='json', auth='user', POST, and authenticates with the Odoo
// session cookie that ConnectScreen's login established. jsonRpc() already sends
// withCredentials and unwraps the JSON-RPC envelope, so a call here is one line.
//
// TWO CONVENTIONS THIS MODULE NORMALISES, because they bite everywhere:
//
//  1. Odoo returns `false` — never null — for every empty Many2one, Datetime and
//     Binary-derived field. `avatar_url`, `media_url`, `last_at`, `reply_to_id`,
//     `other_user_id`, `link`, `poll` are all `false` when absent. Everything
//     leaving this file uses null instead, so screens can use `?.` and `??`.
//
//  2. Application failures come back as `{status: false, message: '...'}` with
//     HTTP 200 — the key is `message`, NOT `error`. A thrown Odoo exception is a
//     different thing entirely (jsonRpc throws for those). `call()` below turns a
//     status:false into a thrown ChatError so callers only handle one failure mode.
//
// Ids are always sent as integers: the server does bare int(x or 0) casts, so a
// non-numeric string raises server-side instead of returning a clean error.
import { getConnection } from '../api/session';
import { jsonRpc } from '../api/odooApi';
import { createLogger } from '../api/logger';

const log = createLogger('Chat');

// Long enough for a slow first sync, short enough to fail before a user gives up.
const T = 20000;
const T_UPLOAD = 120000;

export class ChatError extends Error {
  constructor(message) {
    super(message || 'Something went wrong.');
    this.name = 'ChatError';
    this.isChatError = true;   // lets screens tell "server said no" from "network died"
  }
}

async function call(path, params = {}, timeout = T) {
  const { serverUrl } = await getConnection();
  if (!serverUrl) throw new ChatError('This device is not set up yet.');
  const res = await jsonRpc(serverUrl, path, params, timeout);
  // A route that returns nothing at all is still a success (some only echo status).
  if (res && res.status === false) throw new ChatError(res.message);
  return res || {};
}

// Absolute URL for an avatar/media path the server handed back as a root-relative
// string. Returns null for Odoo's `false`, so <Image source={{uri}}> is never fed
// a broken value.
//
// These are auth='user' endpoints: the request must carry the session cookie. On
// both platforms RN's Image loader uses the native cookie store that axios also
// writes to, so this works — but it is the reason a logged-out app shows blank
// avatars rather than 404s.
export async function absUrl(path) {
  if (!path || path === true) return null;
  const { serverUrl } = await getConnection();
  if (!serverUrl) return null;
  const base = String(serverUrl).replace(/\/+$/, '');
  return `${base}${path}`;
}

// Odoo `false` → null, for the fields documented as nullable.
const nz = (v) => (v === false || v === undefined ? null : v);

// ─────────────────────────────── normalisers ───────────────────────────────
// Screens and components consume ONLY these shapes. When a route's payload
// changes, this is the one place to fix.

export function normalizeMessage(m, serverBase) {
  const abs = (p) => (p && serverBase ? `${serverBase}${p}` : null);
  return {
    id: m.id,
    conversationId: m.conversation_id,
    authorId: m.author_id,
    authorName: m.author_name || '',
    authorAvatar: m.author_id ? abs(`/chats_369/avatar/user/${m.author_id}`) : null,
    mine: !!m.mine,
    body: m.body || '',
    kind: m.kind || 'text',
    deleted: !!m.deleted,
    // Server-computed: author, not already deleted, and within the 24h unsend
    // window. Older servers omit it, so fall back to the author check alone.
    canDeleteAll: m.can_delete_all === undefined ? (!!m.mine && !m.deleted) : !!m.can_delete_all,
    edited: !!m.edited,
    forwarded: !!m.forwarded,
    isMeet: !!m.is_meet,
    // Call history card — `duration` below carries the call length.
    isCall: !!m.is_call,
    callVideo: !!m.call_video,
    callMissed: !!m.call_missed,
    starred: !!m.starred,
    pinned: !!m.pinned,
    pinExpiry: nz(m.pin_expiry),

    // Media. `has_media` is the gate — media_url is false when withheld (deleted,
    // or a view-once already burned), so never build a URL off kind alone.
    hasMedia: !!m.has_media,
    mediaUrl: m.has_media ? abs(m.media_url) : null,
    fileName: m.file_name || '',
    mimetype: m.mimetype || '',
    fileSize: m.file_size || 0,
    duration: m.duration || 0,
    viewOnce: !!m.view_once,
    viewed: !!m.viewed,

    // `quoted` is the single flag to render a quote block: it covers both a real
    // in-thread reply and a cross-chat "reply privately" quote. Only when
    // replyToId is a number can you scroll to the original.
    quoted: !!m.quoted,
    replyToId: nz(m.reply_to_id),
    replyToAuthor: m.reply_to_author || '',
    replyToBody: m.reply_to_body || '',

    link: nz(m.link),
    poll: nz(m.poll),
    reactions: m.reactions || [],
    created: nz(m.created),
    // Only meaningful when mine === true; the server computes it for every message.
    status: m.status || 'sent',
  };
}

export function normalizeConversation(c, serverBase) {
  const abs = (p) => (p && serverBase ? `${serverBase}${p}` : null);
  const otherUserId = nz(c.other_user_id);
  return {
    id: c.id,
    isGroup: !!c.is_group,
    // No `is_self` key exists on this payload — a self-chat is the 1:1 with no
    // other user. (/chat/contact_info does expose is_self; this route doesn't.)
    isSelf: !c.is_group && otherUserId == null,
    title: c.title || 'Chat',
    avatarUrl: abs(nz(c.avatar_url)),
    lastPreview: c.last_preview || '',
    lastKind: nz(c.last_kind),
    lastAt: nz(c.last_at),
    unreadCount: c.unread_count || 0,
    unread: !!c.unread,
    manualUnread: !!c.manual_unread,
    online: !!c.online,
    lastSeen: nz(c.last_seen),
    pinned: !!c.pinned,
    favourite: !!c.favourite,
    archived: !!c.archived,
    // Already accounts for muted_until expiry server-side — trust it directly.
    muted: !!c.muted,
    otherUserId,
    otherMobile: c.other_mobile || '',
    blockedByMe: !!c.blocked_by_me,
    memberCount: c.member_count || 0,
    oversight: !!c.oversight,   // admin_all monitor rows only
  };
}

export function normalizeContact(u, serverBase) {
  return {
    id: u.id,
    name: u.name || '',
    mobile: u.mobile || '',
    role: u.role || 'developer',
    avatarUrl: u.avatar_url && serverBase ? `${serverBase}${u.avatar_url}` : null,
  };
}

async function base() {
  const { serverUrl } = await getConnection();
  return serverUrl ? String(serverUrl).replace(/\/+$/, '') : '';
}

// ─────────────────────────────── identity ───────────────────────────────

// My profile + settings. Also the only way to READ settings — /chat/settings writes.
export async function fetchMe() {
  const b = await base();
  const res = await call('/chat/me');
  const me = res.me || {};
  return {
    id: me.id,
    name: me.name || '',
    mobile: me.mobile || '',
    role: me.role || 'developer',
    about: me.about || '',
    avatarUrl: me.avatar_url && b ? `${b}${me.avatar_url}` : null,
    lastSeenPrivacy: me.last_seen_privacy || 'everyone',
    onlinePrivacy: me.online_privacy || 'everyone',
    readReceipts: !!me.read_receipts,
    notifMessages: !!me.notif_messages,
    notifGroups: !!me.notif_groups,
    notifSound: !!me.notif_sound,
    notifPreview: !!me.notif_preview,
  };
}

// avatar: raw base64 (expo-image-picker with base64:true). The server tolerates a
// data: prefix here (unlike group photos, which do not strip it).
export async function saveProfile({ name, about, avatar } = {}) {
  const p = {};
  if (name != null) p.name = name;
  if (about != null) p.about = about;
  if (avatar != null) p.avatar = avatar;
  return call('/chat/profile', p, T_UPLOAD);
}

export function saveSettings(settings) { return call('/chat/settings', settings); }
export function savePrivacy(privacy) { return call('/chat/privacy', privacy); }

// ─────────────────────────────── contacts & chats ───────────────────────────────

// Server-side this is restricted to internal users who have BOTH a mobile number
// and app-login enabled — those are kra_kpi_module fields, so the roster is
// defined by that module even though this is the chat API.
export async function fetchContacts(query = '') {
  const b = await base();
  const res = await call('/chat/contacts', { query: query || '' });
  return (res.contacts || []).map((u) => normalizeContact(u, b));
}

// filter: 'all' | 'unread' | 'favourites' | 'groups' | 'archived' | 'admin_all'
//         | <chat.list id>
// Returned already sorted: pinned first, then last activity descending.
// NOTE unreadTotal here is scoped to the FILTER — use fetchUnreadTotal() for the
// app badge.
export async function fetchConversations(filter = 'all') {
  const b = await base();
  const res = await call('/chat/conversations', { filter });
  return {
    conversations: (res.conversations || []).map((c) => normalizeConversation(c, b)),
    unreadTotal: res.unread_total || 0,
  };
}

export async function fetchUnreadTotal() {
  const res = await call('/chat/unread_total');
  return res.unread_total || 0;
}

// Get-or-create the 1:1 with someone. Creates no message, so the chat will not
// appear in the conversation list until something is sent.
export async function openDirect(userId) {
  const b = await base();
  const res = await call('/chat/open_direct', { user_id: Number(userId) });
  return normalizeConversation(res.conversation || {}, b);
}

export async function openSelf() {
  const b = await base();
  const res = await call('/chat/open_self');
  return normalizeConversation(res.conversation || {}, b);
}

export async function createGroup(name, memberIds = []) {
  const b = await base();
  const res = await call('/chat/create_group', {
    name, member_ids: memberIds.map(Number),
  });
  return normalizeConversation(res.conversation || {}, b);
}

// action: 'leave' | 'rename' | 'description' | 'add' | 'remove' | 'photo' | 'promote'
// 'leave' is the one action that returns no conversation — hence the null.
export async function updateGroup(conversationId, action, extra = {}) {
  const b = await base();
  const res = await call('/chat/group/update', {
    conversation_id: Number(conversationId), action, ...extra,
  }, action === 'photo' ? T_UPLOAD : T);
  return res.conversation ? normalizeConversation(res.conversation, b) : null;
}

// Omit `field` to read. When writing, pass a real boolean: the server does
// bool(value), and the STRING "false" is truthy in Python — it would turn the
// permission on.
export async function groupPermissions(conversationId, field, value) {
  const p = { conversation_id: Number(conversationId) };
  if (field) { p.field = field; p.value = !!value; }
  const res = await call('/chat/group/permissions', p);
  return res.permissions || {};
}

// Groups: marks me as left. 1:1/self: just hides the row — it comes back on the
// next incoming message, and no messages are deleted (that's clearChat).
export function leaveChat(conversationId) {
  return call('/chat/leave_chat', { conversation_id: Number(conversationId) });
}

// ─────────────────────────────── messages ───────────────────────────────

// Cursor pagination on message id — there is NO offset and no has_more field.
//   neither cursor → newest `limit`
//   beforeId       → the page immediately older than that id (scroll-back)
//   afterId        → the OLDEST `limit` newer than that id (incremental catch-up,
//                    so loop until you get fewer than `limit` back)
// The array is ALWAYS ascending by id in all three cases. limit is capped at 100.
export async function fetchMessages(conversationId, { limit = 50, beforeId, afterId } = {}) {
  const b = await base();
  const p = { conversation_id: Number(conversationId), limit: Math.min(limit, 100) };
  if (afterId) p.after_id = Number(afterId);
  else if (beforeId) p.before_id = Number(beforeId);
  const res = await call('/chat/messages', p);
  return (res.messages || []).map((m) => normalizeMessage(m, b));
}

// Context around one message (search hit / pinned jump): 30 before including the
// anchor, then 30 after. Fixed window, ascending, no limit param.
export async function fetchMessagesAround(conversationId, messageId) {
  const b = await base();
  const res = await call('/chat/messages_around', {
    conversation_id: Number(conversationId), message_id: Number(messageId),
  });
  return (res.messages || []).map((m) => normalizeMessage(m, b));
}

// Text only — media goes through sendMedia(). The returned message always has
// link:null even for a URL body: the server scrapes the preview in a background
// thread after responding, so the card shows up on a later bus event or refetch.
export async function sendText(conversationId, body, { replyToId, quoteAuthor, quoteBody } = {}) {
  const b = await base();
  const p = { conversation_id: Number(conversationId), body };
  if (replyToId) p.reply_to_id = Number(replyToId);
  else if (quoteAuthor || quoteBody) { p.quote_author = quoteAuthor || ''; p.quote_body = quoteBody || ''; }
  const res = await call('/chat/send', p);
  return normalizeMessage(res.message || {}, b);
}

// Server-enforced caps, on the DECODED byte length. Checked client-side too so a
// too-big file fails instantly instead of after uploading 20 MB of base64.
export const MEDIA_LIMITS = {
  image: 10 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 25 * 1024 * 1024,
};

export function mediaLimitFor(kind) { return MEDIA_LIMITS[kind] || MEDIA_LIMITS.document; }

// Media upload is base64-in-JSON, NOT multipart — /chat/send_media is a type='json'
// route. Two consequences worth knowing:
//   • base64 inflates ~33%, so a 16 MB video is a ~21 MB request body. That has to
//     clear both Odoo's and any reverse proxy's body-size limit.
//   • Unlike /chat/profile, this route does NOT strip a `data:` prefix. Pass bare
//     base64 (expo-image-picker's `base64` field already is).
//
// `kind` must be one of image|video|audio|document — anything else is silently
// filed as a document. The server never sniffs the file; kind and mimetype are
// taken on trust, and kind is what every client renders from.
export async function sendMedia(conversationId, {
  kind = 'document', fileB64, fileName = '', mimetype = '',
  caption = '', duration = 0, viewOnce = false, replyToId,
} = {}, onProgress = null) {
  if (!fileB64) throw new ChatError('No file selected.');
  // base64 → bytes is 3/4 of the string length (minus padding).
  const approxBytes = Math.floor((fileB64.length * 3) / 4);
  const limit = mediaLimitFor(kind);
  if (approxBytes > limit) {
    throw new ChatError(`${kind[0].toUpperCase()}${kind.slice(1)} is too large (max ${Math.round(limit / 1024 / 1024)} MB).`);
  }

  const { serverUrl } = await getConnection();
  if (!serverUrl) throw new ChatError('This device is not set up yet.');
  const p = {
    conversation_id: Number(conversationId),
    kind, file_b64: fileB64, caption,
    file_name: String(fileName).slice(0, 200),
    mimetype: String(mimetype).slice(0, 100),
    duration: Number(duration) || 0,
    view_once: !!viewOnce,
  };
  if (replyToId) p.reply_to_id = Number(replyToId);

  // onProgress reports the base64 body size, ~1.33x the real file — drive a bar
  // off these numbers, not off the file size.
  const res = await jsonRpc(serverUrl, '/chat/send_media', p, T_UPLOAD, null, onProgress);
  if (res && res.status === false) throw new ChatError(res.message);
  const b = String(serverUrl).replace(/\/+$/, '');
  return normalizeMessage((res || {}).message || {}, b);
}

// Per-conversation media/docs/links. tab: 'media' | 'docs' | 'links'.
// month_label is server-computed ('This Month' or 'June 2026') — use it for
// section headers rather than re-deriving from `created`.
export async function fetchMediaList(conversationId, tab = 'media') {
  const b = await base();
  const res = await call('/chat/media_list', { conversation_id: Number(conversationId), tab });
  return (res.items || []).map((i) => ({
    id: i.id, kind: i.kind, name: i.name || '',
    url: i.url && i.url.startsWith('/') ? `${b}${i.url}` : i.url,
    // Needed to hand the OS a real intent type. Empty on a server that predates
    // the field, which falls back to the old */* behaviour rather than breaking.
    mimetype: i.mimetype || '',
    created: nz(i.created), monthLabel: i.month_label || '',
  }));
}

// upToMessageId omitted → the server marks up to the conversation's newest.
// Cursors only ever move forward, so a stale value is harmless.
export function markRead(conversationId, upToMessageId) {
  const p = { conversation_id: Number(conversationId) };
  if (upToMessageId) p.up_to_message_id = Number(upToMessageId);
  return call('/chat/mark_read', p);
}

// Clears every unread, including archived and hidden chats. Note it emits no bus
// events, so other people's ticks won't turn blue until they refetch.
export function markAllRead() { return call('/chat/mark_all_read'); }

// Sets a manual unread dot WITHOUT rewinding the read cursor, so the row comes
// back unreadCount:0 but unread:true. markRead() is the only way to clear it.
export function markUnread(conversationId) {
  return call('/chat/mark_unread', { conversation_id: Number(conversationId) });
}

// ─────────────────────────────── message actions ───────────────────────────────

export async function react(messageId, emoji) {
  const b = await base();
  const res = await call('/chat/react', { message_id: Number(messageId), emoji: emoji || '' });
  return normalizeMessage(res.message || {}, b);
}

export async function star(messageId, starred) {
  const b = await base();
  const res = await call('/chat/star', { message_id: Number(messageId), starred: !!starred });
  return normalizeMessage(res.message || {}, b);
}

export async function fetchStarred() {
  const b = await base();
  const res = await call('/chat/starred_messages');
  return (res.messages || []).map((m) => ({
    ...normalizeMessage(m, b), conversationTitle: m.conversation_title || '',
  }));
}

// Author-only, and only within 15 minutes of sending — reflect both in the UI or
// users hit a server error they can't act on.
export async function editMessage(messageId, body) {
  const b = await base();
  const res = await call('/chat/edit_message', { message_id: Number(messageId), body });
  return normalizeMessage(res.message || {}, b);
}

// scope 'everyone' is author-only and soft-deletes (the row stays, blanked).
// scope 'me' removes it for this user only, emits NO bus event, and returns
// { removed: true } instead of a message — the caller must drop it locally.
export async function deleteMessage(messageId, scope = 'everyone') {
  const b = await base();
  const res = await call('/chat/delete_message', { message_id: Number(messageId), scope });
  if (res.removed) return { removed: true, messageId: res.message_id };
  return { removed: false, message: normalizeMessage(res.message || {}, b) };
}

// Returns status only, and the server excludes the forwarder from its own bus
// broadcast — so nothing tells you it worked. Refetch the target thread.
export function forwardMessage(messageId, toConversationId) {
  return call('/chat/forward', {
    message_id: Number(messageId), to_conversation_id: Number(toConversationId),
  });
}

// days must be one of 1 | 7 | 14 | 30. Max 3 pinned messages per chat; there is
// no way to pin without an expiry through the API.
export async function pinMessage(messageId, pinned, days = 7) {
  const b = await base();
  const res = await call('/chat/pin_message', {
    message_id: Number(messageId), pinned: !!pinned, days,
  });
  return normalizeMessage(res.message || {}, b);
}

export async function fetchPinned(conversationId) {
  const b = await base();
  const res = await call('/chat/pinned_messages', { conversation_id: Number(conversationId) });
  return (res.messages || []).map((m) => normalizeMessage(m, b));
}

// Author-only. Read/delivered receipts detail for one message.
export async function messageInfo(messageId) {
  const b = await base();
  const res = await call('/chat/message_info', { message_id: Number(messageId) });
  const people = (list) => (list || []).map((p) => ({
    userId: p.user_id, name: p.name, at: nz(p.at),
    avatarUrl: p.avatar_url && b ? `${b}${p.avatar_url}` : null,
  }));
  return {
    isGroup: !!res.is_group,
    memberCount: res.member_count || 0,
    read: people(res.read),
    delivered: people(res.delivered),
  };
}

// Burns a view-once media. Call it the moment the viewer opens.
export async function viewOnceSeen(messageId) {
  const b = await base();
  const res = await call('/chat/view_once_seen', { message_id: Number(messageId) });
  return normalizeMessage(res.message || {}, b);
}

// seconds must be 0 | 86400 | 604800 | 7776000 — anything else silently becomes 0.
// Applies to FUTURE messages only; changing it never retro-applies.
export function setDisappear(conversationId, seconds) {
  return call('/chat/set_disappear', {
    conversation_id: Number(conversationId), seconds: Number(seconds) || 0,
  });
}

// ─────────────────────────────── conversation actions ───────────────────────────────

// Max 3 pinned chats — throws ChatError('You can only pin up to 3 chats.') past that.
export function pinConversation(conversationId, pinned) {
  return call('/chat/pin_conversation', {
    conversation_id: Number(conversationId), pinned: !!pinned,
  });
}

export function archiveConversation(conversationId, archived) {
  return call('/chat/archive', { conversation_id: Number(conversationId), archived: !!archived });
}

export function favouriteConversation(conversationId, favourite) {
  return call('/chat/favourite', { conversation_id: Number(conversationId), favourite: !!favourite });
}

// hours 0 = forever. Server-side mute only suppresses PUSH — bus events still
// arrive, so the client must silence its own in-app banner and sound.
export function muteConversation(conversationId, muted, hours = 0) {
  return call('/chat/mute', {
    conversation_id: Number(conversationId), muted: !!muted, hours: Number(hours) || 0,
  });
}

// Hides existing messages for me only. New messages still arrive — there is no
// server-side "cleared at" watermark.
export function clearChat(conversationId) {
  return call('/chat/clear_chat', { conversation_id: Number(conversationId) });
}

// Stored one-directionally but enforced both ways: either side blocking kills
// messaging, calls and presence in both directions.
export async function blockUser(userId, blocked) {
  const res = await call('/chat/block', { user_id: Number(userId), blocked: !!blocked });
  return !!res.blocked;
}

// nick '' deletes the nickname. Nicknames override the 1:1 title everywhere
// server-side, so screens just render `title`.
export function setNickname(userId, nick) {
  return call('/chat/set_nickname', { user_id: Number(userId), nick: nick || '' });
}

// Shape branches on is_group — group gets members/permissions/isAdmin, 1:1 gets
// the other user's details.
export async function contactInfo(conversationId) {
  const b = await base();
  const res = await call('/chat/contact_info', { conversation_id: Number(conversationId) });
  const i = res.info || {};
  const common = {
    conversationId: i.conversation_id,
    isGroup: !!i.is_group,
    isSelf: !!i.is_self,
    title: i.title || '',
    favourite: !!i.favourite,
    muted: !!i.muted,
    disappearSeconds: i.disappear_seconds || 0,
    media: i.media || { photos: 0, videos: 0, docs: 0 },
    avatarUrl: i.avatar_url && b ? `${b}${i.avatar_url}` : null,
  };
  if (i.is_group) {
    return {
      ...common,
      name: i.name || '',
      description: i.description || '',
      memberCount: i.member_count || 0,
      meId: i.me_id,
      isAdmin: !!i.is_admin,
      permissions: i.permissions || {},
      members: (i.members || []).map((m) => ({
        id: m.id, name: m.name, isAdmin: !!m.is_admin, mobile: m.mobile || '',
        avatarUrl: m.avatar_url && b ? `${b}${m.avatar_url}` : null,
      })),
    };
  }
  return {
    ...common,
    userId: nz(i.user_id),
    name: i.name || '',
    mobile: i.mobile || '',
    role: i.role || 'developer',
    nickname: i.nickname || '',
    blockedByMe: !!i.blocked_by_me,
    about: i.about || '',
    // Fresh at open time, unlike the conversation row a screen was handed on
    // navigation. Same mutually-exclusive contract as normalizeConversation.
    //
    // hasPresence distinguishes "the server says offline / withheld it" from "this
    // server predates the field". Without it a caller can't tell a real false from
    // a missing key, and would either ignore fresh data or show a stale last seen
    // the server deliberately withheld.
    hasPresence: 'online' in i,
    online: !!i.online,
    lastSeen: nz(i.last_seen),
  };
}

// ─────────────────────────────── search ───────────────────────────────

// Both are plain ILIKE — no ranking, no filename matching. date is 'YYYY-MM-DD'
// and is concatenated server-side, so a malformed value raises rather than
// returning a clean error; validate before calling.
export async function searchMessages(conversationId, query, date) {
  const b = await base();
  const p = { conversation_id: Number(conversationId) };
  if (query) p.query = query;
  if (date) p.date = date;
  const res = await call('/chat/search_messages', p);
  return (res.messages || []).map((m) => normalizeMessage(m, b));
}

// Needs at least 2 characters; capped at 50 results.
export async function searchAll(query) {
  const res = await call('/chat/search_all', { query });
  return (res.results || []).map((r) => ({
    messageId: r.msg_id,
    conversationId: r.conv_id,
    conversationTitle: r.conv_title || '',
    author: r.author || '',
    snippet: r.snippet || '',
    created: nz(r.created),
  }));
}

// ─────────────────────────────── media library ───────────────────────────────

// Across every chat I'm in. Adds `chat` and `author` per item vs fetchMediaList.
export async function fetchAllMedia(tab = 'media') {
  const b = await base();
  const res = await call('/chat/all_media', { tab });
  return (res.items || []).map((i) => ({
    id: i.id, kind: i.kind, name: i.name || '',
    url: i.url && i.url.startsWith('/') ? `${b}${i.url}` : i.url,
    mimetype: i.mimetype || '',   // see fetchMediaList
    created: nz(i.created), monthLabel: i.month_label || '',
    chat: i.chat || '', author: i.author || '', duration: i.duration || 0,
  }));
}

// ─────────────────────────────── lists ───────────────────────────────

// Pass conversationId to have each list report whether it contains that chat.
export async function fetchLists(conversationId) {
  const p = {};
  if (conversationId) p.conversation_id = Number(conversationId);
  const res = await call('/chat/lists', p);
  return (res.lists || []).map((l) => ({
    id: l.id, name: l.name || '', emoji: l.emoji || '', count: l.count || 0, has: !!l.has,
  }));
}

// There is no rename route — editing a list means delete + recreate.
export async function createList(name, emoji = '', conversationIds = []) {
  const res = await call('/chat/create_list', {
    name, emoji, conversation_ids: conversationIds.map(Number),
  });
  return res.list_id;
}

export async function toggleList(listId, conversationId) {
  const res = await call('/chat/list_toggle', {
    list_id: Number(listId), conversation_id: Number(conversationId),
  });
  return { has: !!res.has, count: res.count || 0 };
}

export function deleteList(listId) { return call('/chat/delete_list', { list_id: Number(listId) }); }

// ─────────────────────────────── polls ───────────────────────────────

// Minimum 2 options, and the server truncates to 12.
export async function createPoll(conversationId, question, options, multi = false) {
  const b = await base();
  const res = await call('/chat/poll/create', {
    conversation_id: Number(conversationId), question,
    options: options.filter((o) => String(o).trim()).slice(0, 12), multi: !!multi,
  });
  return normalizeMessage(res.message || {}, b);
}

// Voting TOGGLES: voting an option you already chose removes it. On a
// single-choice poll a new vote clears your previous one server-side.
// Debounce the button — the duplicate-vote guard is a racy search-then-create.
export async function votePoll(optionId) {
  const b = await base();
  const res = await call('/chat/poll/vote', { option_id: Number(optionId) });
  return normalizeMessage(res.message || {}, b);
}

// ─────────────────────────────── group invite ───────────────────────────────

// action: 'get' | 'create' | 'reset' | 'revoke'. Group admins, or anyone when
// perm_invite is on. NOTE the join half (/chat/join/<token>) is an HTTP route
// that redirects into the Odoo backend — there is no JSON join endpoint, so a
// link can be shared from the app but not consumed by it.
export async function groupInvite(conversationId, action = 'get') {
  const res = await call('/chat/group/invite', {
    conversation_id: Number(conversationId), action,
  });
  return { token: nz(res.token), link: nz(res.link) };
}

// ─────────────────────────────── google meet ───────────────────────────────

// Status is read on every thread open (to label the Meet entry) as well as by the
// settings panel, so it is memoised briefly. Anything that can change it —
// saving the config, coming back from the OAuth browser — calls invalidate.
let gmeetCache = null;   // { at, value }
const GMEET_TTL = 60000;

export function invalidateGmeetStatus() { gmeetCache = null; }

export async function gmeetStatus({ force = false } = {}) {
  if (!force && gmeetCache && Date.now() - gmeetCache.at < GMEET_TTL) return gmeetCache.value;
  const res = await call('/chat/gmeet/status');
  const value = {
    connected: !!res.connected, hasCreds: !!res.has_creds, isAdmin: !!res.is_admin,
    triggers: res.triggers || [], scope: res.scope || 'both', adminOnly: !!res.admin_only,
    // Admin-only fields — the server blanks these for everyone else.
    clientId: res.client_id || '', baseUrl: res.base_url || '', redirectUri: res.redirect_uri || '',
  };
  gmeetCache = { at: Date.now(), value };
  return value;
}

// Admins only, server-side. `clientSecret` is write-only: the status route never
// returns it, and the config route only writes it when non-empty — so leaving the
// field blank keeps whatever is already stored.
export async function saveGmeetConfig({ clientId, clientSecret, triggers, scope, adminOnly, baseUrl }) {
  const p = {
    client_id: clientId || '',
    triggers: triggers || '',
    admin_only: !!adminOnly,
    base_url: baseUrl || '',
  };
  // The server ignores anything outside this set, so don't send a bad value.
  if (['groups', 'direct', 'both'].includes(scope)) p.scope = scope;
  if (clientSecret) p.client_secret = clientSecret;
  const res = await call('/chat/gmeet/config', p);
  invalidateGmeetStatus();
  return res;
}

// The redirect URI Google must be given. Mirrors the web client: a base URL typed
// into the form wins over whatever the server last resolved, so an admin can see
// the value change before saving.
export function gmeetRedirectUri(baseUrl, fallback) {
  const b = (baseUrl || '').trim().replace(/\/+$/, '');
  return b ? `${b}/chat/gmeet/oauth/callback` : (fallback || '');
}

export function gmeetOauthStartUrl(serverUrl) {
  return `${(serverUrl || '').replace(/\/+$/, '')}/chat/gmeet/oauth/start`;
}

// Posts a message carrying the Meet URL with is_meet set — render it as a
// "Join meeting" card and open with Linking.
export async function createMeet(conversationId) {
  const b = await base();
  const res = await call('/chat/create_meet', { conversation_id: Number(conversationId) }, 30000);
  return normalizeMessage(res.message || {}, b);
}

// ─────────────────────────────── calls ───────────────────────────────
//
// PLACING a call needs WebRTC (react-native-webrtc), which this app does not
// carry — and, just as importantly, a bus client: ring events arrive only on the
// Odoo bus, and services/chatRealtime.js is a poller that stops when
// backgrounded. Scheduling, history and favourites are plain JSON routes, so
// those work today.

// History + favourites + scheduled.
export async function fetchCalls() {
  const b = await base();
  const av = (p) => (p && b ? `${b}${p}` : null);
  const res = await call('/chat/calls');
  return {
    recent: (res.recent || []).map((c) => ({
      id: c.id, conversationId: c.conversation_id, userId: c.user_id, name: c.name || '',
      avatarUrl: av(nz(c.avatar)), outgoing: !!c.outgoing, video: !!c.video,
      missed: !!c.missed, duration: c.duration || 0, created: nz(c.created),
    })),
    favorites: (res.favorites || []).map((f) => ({
      conversationId: f.conversation_id, userId: f.user_id, name: f.name || '', avatarUrl: av(nz(f.avatar)),
    })),
    upcoming: (res.upcoming || []).map((u) => ({
      id: u.id, title: u.title || '', when: nz(u.when), video: !!u.video,
      mine: !!u.mine, organizer: u.organizer || '', conversationId: nz(u.conversation_id),
    })),
  };
}

// Schedule a call. `when` MUST be a UTC ISO string: the server normalises it with
// `when.replace('T',' ').replace('Z','')[:19]`, so it stores whatever timezone it
// is handed — send local time and the reminder fires at the wrong hour.
export async function scheduleCall({ title, when, video = false, conversationId = 0 }) {
  const res = await call('/chat/call/schedule', {
    title: String(title || '').slice(0, 120),
    when: when instanceof Date ? when.toISOString() : String(when || ''),
    video: !!video,
    conversation_id: Number(conversationId) || 0,
  });
  return res.id;
}

// Organiser only. The server silently no-ops for anyone else rather than
// failing, so callers must gate on the `mine` flag from fetchCalls() instead of
// waiting for an error that never comes.
export function cancelScheduledCall(id) {
  return call('/chat/call/schedule/cancel', { id: Number(id) });
}

// ──────────────────────────── live calls (WebRTC) ────────────────────────────
//
// Signalling transport only — the media path is `services/callEngine.js`. Every
// route below just relays to the other party over the bus, so a response of
// {status:true} means "handed to the server", NOT "the peer received it".
//
// Two server rules worth knowing, because both return status:false and `call()`
// turns those into a thrown ChatError:
//   * calls are 1:1 — a group conversation_id is rejected outright;
//   * every route except /ice requires a non-empty call_id, which is the only
//     thing binding a relayed payload to a call the peer actually started.

// ICE servers for a call. conversation_id is REQUIRED to get TURN: the server
// releases TURN credentials only to a member of that chat, and returns bare STUN
// otherwise. Passing 0 is therefore valid but yields a config that fails across
// NAT — always pass the real conversation.
export async function fetchIceServers(conversationId) {
  const res = await call('/chat/call/ice', { conversation_id: Number(conversationId) || 0 }, 10000);
  return res.ice || [];
}

// Ring the other member. Returns the server-minted call_id that every subsequent
// signalling call must echo back, plus the ICE config (saving a second round trip).
export async function startCall(conversationId, video = false) {
  const res = await call('/chat/call/start', {
    conversation_id: Number(conversationId), video: !!video,
  }, 15000);
  return { callId: res.call_id || null, ice: res.ice || [] };
}

export function acceptCall(conversationId, callId) {
  return call('/chat/call/accept', { conversation_id: Number(conversationId), call_id: String(callId || '') });
}

export function rejectCall(conversationId, callId) {
  return call('/chat/call/reject', { conversation_id: Number(conversationId), call_id: String(callId || '') });
}

// `data` is stringified here rather than by callers: the server relays it opaquely
// and the peer JSON.parses it, so the two sides must agree it is always a string.
export function sendCallSignal(conversationId, callId, kind, data) {
  return call('/chat/call/signal', {
    conversation_id: Number(conversationId),
    call_id: String(callId || ''),
    kind: String(kind || ''),
    data: typeof data === 'string' ? data : JSON.stringify(data),
  });
}

// `log` must be true for the CALLER ONLY. The server writes the chat.call history
// row and the "📞 Call · 0:42" system message from whichever side sets it, so both
// sides logging produces two of each.
export function endCall(conversationId, callId, { duration = 0, missed = false, video = false, log = false } = {}) {
  return call('/chat/call/end', {
    conversation_id: Number(conversationId),
    call_id: String(callId || ''),
    duration: Number(duration) || 0,
    missed: missed ? 1 : 0,
    video: video ? 1 : 0,
    log: log ? 1 : 0,
  });
}

// ─────────────────────────────── link preview ───────────────────────────────

// Compose-time preview, so a pasted URL shows a card BEFORE it is sent.
//
// Two things to respect: the server scrapes synchronously with a 6s timeout, so
// debounce hard and never call it per keystroke; and it refuses private/loopback
// hosts (SSRF guard), returning status:false with no message. A refusal is
// normal, not an error — return null and show nothing.
export async function fetchLinkPreview(url) {
  const { serverUrl } = await getConnection();
  if (!serverUrl || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await jsonRpc(serverUrl, '/chat/link_preview', { url }, 12000);
    if (!res || res.status === false) return null;
    return {
      url: res.url || url,
      title: res.title || '',
      desc: res.desc || '',
      image: res.image || '',
    };
  } catch (e) {
    log.warn('link preview failed', e?.message);
    return null;
  }
}

// The first http(s) URL in a body, or null. Used to decide whether to ask the
// server for a preview at all.
export function firstUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[.,;:!?)\]}]+$/, '') : null;
}

// ─────────────────────────────── presence ───────────────────────────────

// The online window is 45s, so beat faster than that while the app is foregrounded.
// fetchConversations and fetchMessages also stamp presence as a side effect.
export function heartbeat() { return call('/chat/heartbeat', {}, 8000); }

// Tell the server we are leaving, so the other side sees "last seen" immediately
// instead of up to 45s of stale "online". Presence can otherwise only lapse.
// Short timeout: this fires as the app backgrounds and must not hang.
export function markAway() { return call('/chat/heartbeat', { away: true }, 5000); }

// Plain-text transcript of a conversation. /chat/export is type='http', not the
// JSON-RPC envelope every other call uses, so it is fetched directly — and it
// needs credentials, like every other authenticated Odoo route here.
export async function fetchTranscript(conversationId) {
  const { serverUrl } = await getConnection();
  if (!serverUrl) throw new ChatError('This device is not set up yet.');
  const res = await fetch(`${serverUrl}/chat/export/${Number(conversationId)}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new ChatError('Could not export this chat.');
  return res.text();
}

export function sendTyping(conversationId, typing = true) {
  return call('/chat/typing', {
    conversation_id: Number(conversationId), typing: !!typing,
  }, 8000).catch((e) => log.warn('typing failed', e?.message));   // never block the composer
}

// The bus channel name to subscribe to for realtime. See services/chatRealtime.js.
export async function fetchBusChannel() {
  const res = await call('/chat/bus_channel');
  return res.channel || null;
}
