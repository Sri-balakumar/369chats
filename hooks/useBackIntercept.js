// ANDROID BACK — letting things that are NOT routes handle the back button.
//
// App.js owns a BackHandler, and it is thorough, but it only knows about ROUTES
// (the `appScreen` string). Plenty of what the user perceives as "a page" is not
// a route at all — the archive is `inArchive` state inside ChatListScreen, the
// message selection bar is `selected` inside ChatThreadScreen. Back saw
// appScreen === 'chats', found nothing to pop, and let Android close the app.
// That is exactly the reported bug: back from the archive quit the app.
//
// It also covers the overlay layers that deliberately are NOT React Native
// <Modal>s. ConfirmDialog and CallScreen render as absolutely-positioned layers
// on purpose — on Android, opening a Modal from inside another Modal's onPress
// is a race the second one loses, so they sidestep it. The cost, unaccounted for
// until now, is that they get no onRequestClose and so no back handling at all.
//
// Real <Modal>s need none of this: a native modal window consumes the back press
// before BackHandler ever runs, and they already pass onRequestClose.
//
// LIFO, so the most recently opened thing wins and nested overlays unwind in the
// order they were stacked.
import { useEffect, useRef } from 'react';

const stack = [];

// Called by App.js before any route branch. Returns true if something consumed
// the press, in which case the router must not also act on it.
export function runBackIntercepts() {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    // Handlers return true to consume. A handler that returns false is asleep —
    // it stays registered but lets the press fall through.
    if (stack[i]() === true) return true;
  }
  return false;
}

/**
 * Handle the Android back button while `active`.
 *
 * @param active   register only while this is true
 * @param handler  return true to consume the press, false to let it fall through
 */
export default function useBackIntercept(active, handler) {
  // The handler is read through a ref so a new closure on every render does not
  // churn the stack — re-registering mid-gesture would reorder it and break the
  // LIFO guarantee. Same reasoning as the ref in components/chat/SwipeTabs.
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!active) return undefined;
    const entry = () => ref.current?.();
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
