// Presence text — "online" or "last seen …", the line under a contact's name.
//
// The server decides what you are ALLOWED to see and enforces it in _presence():
//   • online and last_seen are mutually exclusive — never both
//   • both are false when either side has blocked the other
//   • both are false if the other user set last-seen privacy to "nobody", and
//     also if YOU did (WhatsApp's reciprocity rule: hide yours, lose theirs)
//   • "online" means chat_last_seen is within 45 seconds
//
// So an empty result here is a legitimate answer, not missing data — render
// nothing rather than "unknown" or "offline".

// Presence is NOT pushed over the bus; it only refreshes when the conversation
// list is re-polled. Exported so a caller can decide how stale is too stale.
export const ONLINE_WINDOW_SECONDS = 45;

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export default function presenceText({ online, lastSeen, isGroup, memberCount } = {}) {
  // Groups and the self-chat never carry presence — the server returns false.
  if (isGroup) return memberCount ? `${memberCount} members` : '';
  if (online) return 'online';
  if (!lastSeen) return '';

  const d = new Date(lastSeen);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (sameDay(d, now)) return `last seen today at ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `last seen yesterday at ${time}`;

  // Inside a week the weekday is more readable than a date.
  if (now - d < 7 * 864e5) {
    return `last seen ${d.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
  }
  return `last seen ${d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}
