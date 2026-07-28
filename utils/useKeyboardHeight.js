// useKeyboardHeight — the on-screen keyboard's height, live, on every device.
//
// Why not KeyboardAvoidingView: Expo SDK 52+ turns on Android edge-to-edge by
// default, and under edge-to-edge the window is never resized by adjustResize,
// so KeyboardAvoidingView with the usual `behavior={undefined}` on Android does
// nothing at all — the composer stays under the keyboard. Measuring the keyboard
// ourselves and padding by it works identically on both platforms and on any
// keyboard height, which varies a lot between phones and between keyboard apps.
//
// The *ChangeFrame* listeners are the important ones. Switching the system
// keyboard to its emoji panel, a one-handed/floating layout, or a suggestion
// strip appearing all change the height WITHOUT a hide/show pair — with only
// Did/WillShow the padding would freeze at the old height and the last messages
// would sit behind the panel.
//
// Returns the RAW height in dp, measured from the physical bottom of the screen.
// It is deliberately NOT adjusted for the safe-area inset: under edge-to-edge the
// root view extends beneath the navigation bar, so the caller needs both numbers
// and should pad by
//
//     Math.max(keyboardHeight, insets.bottom)
//
// which clears the nav/gesture bar when the keyboard is down, and sits exactly on
// the keyboard when it is up (the keyboard already covers the nav bar).
import { useState, useEffect, useCallback } from 'react';
import { Keyboard, Platform } from 'react-native';

export default function useKeyboardHeight() {
  const [height, setHeight] = useState(0);

  const apply = useCallback((e) => {
    setHeight(Math.max(0, e?.endCoordinates?.height || 0));
  }, []);

  useEffect(() => {
    const subs = [];

    if (Platform.OS === 'ios') {
      // iOS fires Will* early enough to move in step with the keyboard, and
      // WillChangeFrame covers emoji/floating/split transitions.
      subs.push(Keyboard.addListener('keyboardWillChangeFrame', apply));
      subs.push(Keyboard.addListener('keyboardWillShow', apply));
      subs.push(Keyboard.addListener('keyboardWillHide', () => setHeight(0)));
    } else {
      // Android only emits Did*. DidChangeFrame is not guaranteed on every
      // version, so DidShow is kept as the reliable baseline and DidChangeFrame
      // refines it when the panel swaps height (emoji, GIF, suggestion bar).
      subs.push(Keyboard.addListener('keyboardDidShow', apply));
      subs.push(Keyboard.addListener('keyboardDidChangeFrame', apply));
      subs.push(Keyboard.addListener('keyboardDidHide', () => setHeight(0)));
    }

    return () => subs.forEach((sb) => sb.remove());
  }, [apply]);

  return height;
}
