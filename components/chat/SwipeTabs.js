// SWIPE BETWEEN THE TWO ROOT TABS — Chats ⇄ Calls.
//
// Navigation here is a hand-rolled state machine in App.js (an `appScreen`
// string), not React Navigation, and BottomTabs is a floating pill rather than a
// pager. So there is nothing to inherit a swipe from — this supplies it.
//
// WHY CAPTURE PHASE. The first version used onMoveShouldSetPanResponder (bubble
// phase) and only worked in the gaps between scrollables. A vertical FlatList
// claims the responder as soon as the finger moves, and once it has it the
// parent is never asked again — so a swipe that began on the list, which is most
// of the screen, did nothing. Capture asks the parent FIRST, before any child
// can claim it, which is the only way to get a swipe that works anywhere.
//
// The cost of capture is that it also outranks HORIZONTAL children, which would
// otherwise be stolen from — the chat list's filter chips are a horizontal
// FlatList. Hence the lock below: a horizontal scroller marks itself while it is
// being touched, and this stands down for that gesture. See ChipRow.
//
// The gesture test stays strict either way, so vertical scrolling survives:
//   • far enough to be deliberate, not a tap wobble or the start of a scroll
//   • clearly more horizontal than vertical (2:1), so a diagonal flick while
//     scrolling a long list stays a scroll
import React, { useRef } from 'react';
import { View, PanResponder } from 'react-native';

// Tuned to feel like WhatsApp's pager, which reacts almost immediately.
//
// It is the RATIO that protects vertical scrolling, not the distance: a scroll
// has |dy| far larger than |dx|, so it fails the ratio test no matter how short
// the threshold is. That means DISTANCE only needs to be long enough to not fire
// on the wobble of a tap — 16px — rather than the 45 it started at, which is
// what made the swipe feel like hard work.
const DISTANCE = 16;
const RATIO = 1.4;

// Module-level rather than context: it is read inside a PanResponder created
// once, which a context value would not reach without rebuilding the responder
// mid-gesture. Set by horizontal scrollers while the finger is down on them.
let locks = 0;
export const lockSwipe = () => { locks += 1; };
export const unlockSwipe = () => { locks = Math.max(0, locks - 1); };
export const swipeLocked = () => locks > 0;

export default function SwipeTabs({ onLeft, onRight, children, style }) {
  // Kept in a ref so the responder is created once — rebuilding it on every
  // render drops an in-flight gesture.
  const handlers = useRef({ onLeft, onRight });
  handlers.current = { onLeft, onRight };

  const pan = useRef(
    PanResponder.create({
      // Never claim on touch-down: that would swallow every tap in the app.
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: (_evt, g) => (
        !swipeLocked()
        && Math.abs(g.dx) > DISTANCE
        && Math.abs(g.dx) > Math.abs(g.dy) * RATIO
      ),
      // Bubble phase as well as capture. Capture is what catches a swipe that
      // starts on a list; this second chance covers the plain areas and any
      // platform where the capture negotiation goes the other way. Same test, so
      // it can only ever fire on a gesture capture would also have accepted.
      onMoveShouldSetPanResponder: (_evt, g) => (
        !swipeLocked()
        && Math.abs(g.dx) > DISTANCE
        && Math.abs(g.dx) > Math.abs(g.dy) * RATIO
      ),
      onPanResponderRelease: (_evt, g) => {
        if (Math.abs(g.dx) <= DISTANCE || Math.abs(g.dx) <= Math.abs(g.dy) * RATIO) return;
        // Swiping LEFT (negative dx) moves forward, the way pager tabs read.
        if (g.dx < 0) handlers.current.onLeft?.();
        else handlers.current.onRight?.();
      },
      // If something else wins the gesture, drop it rather than fighting.
      onPanResponderTerminationRequest: () => true,
    }),
  ).current;

  return (
    <View style={[{ flex: 1 }, style]} {...pan.panHandlers}>
      {children}
    </View>
  );
}
