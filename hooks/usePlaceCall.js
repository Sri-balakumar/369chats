// PLACING A CALL — the one implementation, shared by every screen that offers a
// call button (chat thread header, contact info circles, Calls tab favourites).
//
// This started life inline in ChatThreadScreen. It moved here the moment a second
// screen needed it, because the two guards below are not obvious and a re-derived
// copy loses them:
//
//   • canCall mirrors canCall() in the web client. `oversight` rows are the admin
//     monitor view — you are watching someone else's chat, not a participant in
//     it. It is also gated on the WebRTC native module actually being present:
//     without a real build there is nothing to place a call with, and offering a
//     button that can only fail is worse than not showing one.
//
//   • callingRef stops repeat presses ever reaching callEngine. A single tap was
//     once producing FIVE /chat/call/start requests, each ringing the callee
//     separately, and the resulting call_id mismatch silently killed the call.
//     callEngine guards re-entry itself now, but this is the cheap outer layer —
//     and a call that dies in "Ringing…" is expensive to debug.
//
// startCall resolves to an error STRING (or null); it does not throw, because
// every failure here is one the user should simply be told about — no mic
// permission, already in a call, the server refusing a blocked contact.
import { useState, useRef, useCallback } from 'react';
import callEngine, { isCallingSupported } from '../services/callEngine';

// `conversation` is optional: screens that are about ONE chat (thread, contact
// info) pass it and read `canCall`. List screens (the Calls tab) have a different
// contact per row, so they gate on `callingSupported` and pass the row's own
// conversation to placeCall instead.
export default function usePlaceCall(conversation) {
  const [callErr, setCallErr] = useState(null);
  const callingRef = useRef(false);

  const convId = conversation?.id;
  const title = conversation?.title ?? conversation?.name;
  const avatarUrl = conversation?.avatarUrl;
  const isGroup = !!conversation?.isGroup;

  const callingSupported = isCallingSupported();

  const canCall = callingSupported
    && !!convId
    && !isGroup
    && !conversation?.oversight
    && !conversation?.blockedByMe;

  // `conv` overrides the hook's conversation — a call-back button in a history
  // list knows its own target. Anything falsy falls back to the hook's.
  const placeCall = useCallback(async (video, conv) => {
    const target = conv
      ? {
        id: conv.id ?? conv.conversationId,
        title: conv.title ?? conv.name,
        avatarUrl: conv.avatarUrl,
        isGroup: !!conv.isGroup,
      }
      : { id: convId, title, avatarUrl, isGroup };

    if (!target.id) return;
    if (!callingSupported) {
      setCallErr('Calling needs the full app build.');
      return;
    }
    if (callingRef.current) return;
    callingRef.current = true;
    try {
      const msg = await callEngine.startCall(target, video);
      if (msg) setCallErr(msg);
    } finally {
      callingRef.current = false;
    }
  }, [convId, title, avatarUrl, isGroup, callingSupported]);

  const clearCallErr = useCallback(() => setCallErr(null), []);

  return { canCall, callingSupported, placeCall, callErr, clearCallErr };
}
