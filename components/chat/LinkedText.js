// LinkedText — message body with URLs, @mentions and phone numbers made tappable.
//
// React Native's <Text> renders a URL as plain characters; nothing is clickable
// unless you split the string yourself and wrap the matches. That is all this
// does — no parsing library, no HTML.
import React from 'react';
import { Text, Linking, Alert } from 'react-native';
import { COLORS } from '../../theme';

// Ordered alternation: explicit scheme first, then bare www., then a plain
// domain. Kept deliberately conservative — over-matching turns ordinary words
// like "e.g" into broken links.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|io|dev|app|co|in|ai|me)(?:\/[^\s<>"']*)?)/gi;

function normalise(raw) {
  const url = raw.replace(/[.,;:!?)\]}]+$/, '');   // strip trailing punctuation
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// Trailing punctuation belongs to the sentence, not the URL — it is matched
// above but rendered as plain text after the link.
function trailing(raw) {
  const m = raw.match(/[.,;:!?)\]}]+$/);
  return m ? m[0] : '';
}

// onLongPress MUST be threaded down to every link span. A <Text> with its own
// onPress becomes its own touch target, so without this a long-press that starts
// on the URL is swallowed and the message never enters selection mode — which is
// exactly how long-press "stopped working" on messages containing a link.
// `highlight` is the active search term. Matches get a marked span so a search
// hit is visible in the bubble itself, not only in the results list. The query is
// user text, not a pattern, so it is escaped before becoming a regex.
function escapeRe(v) {
  return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function Marked({ text, highlight }) {
  const q = (highlight || '').trim();
  if (!q) return text;
  const parts = String(text).split(new RegExp(`(${escapeRe(q)})`, 'ig'));
  return parts.map((p, i) => (
    i % 2 === 1
      ? <Text key={i} style={{ backgroundColor: COLORS.amberBg, fontWeight: '800' }}>{p}</Text>
      : p
  ));
}

export default function LinkedText({ children, style, linkStyle, onLongPress, highlight }) {
  const text = String(children ?? '');
  if (!text) return null;

  const parts = text.split(URL_RE);
  // split() with one capture group yields [plain, match, plain, match, …].
  return (
    <Text style={style} onLongPress={onLongPress}>
      {parts.map((part, i) => {
        if (i % 2 === 0) {
          return part ? <Text key={i}><Marked text={part} highlight={highlight} /></Text> : null;
        }
        const tail = trailing(part);
        const shown = tail ? part.slice(0, -tail.length) : part;
        const href = normalise(part);
        return (
          <Text key={i}>
            <Text
              style={[{ color: COLORS.link, textDecorationLine: 'underline' }, linkStyle]}
              onPress={() => Linking.openURL(href).catch(() => Alert.alert('Could not open', href))}
              onLongPress={onLongPress}
            >
              {shown}
            </Text>
            {tail}
          </Text>
        );
      })}
    </Text>
  );
}
