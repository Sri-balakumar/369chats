// Global test setup — mock the native-only bits so component tests can render
// real screens in Node without a device. These are visual/native modules whose
// behaviour is irrelevant to the LOGIC we're asserting (labels, states, flows).

// Safe-area: return zero insets and pass children straight through.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: ({ children }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
}));

// Vector icons render as their name in a <Text> so queries can still find text.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const Icon = ({ name }) => React.createElement(Text, null, name || 'icon');
  return {
    Ionicons: Icon, MaterialCommunityIcons: Icon, MaterialIcons: Icon,
    FontAwesome: Icon, Feather: Icon, AntDesign: Icon, Entypo: Icon,
  };
});

// AsyncStorage ships its own jest mock; without it every module that touches
// api/session throws "NativeModule: AsyncStorage is null" at import time.
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Native modules with no JS implementation off-device. These are mocked so the
// import smoke test can actually load the screens that use them — without this
// the test can't tell "missing import" from "native module absent under jest".
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({
    record: jest.fn(), pause: jest.fn(), stop: jest.fn(),
    prepareToRecordAsync: jest.fn(), isRecording: false, uri: null,
  }),
  useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0, metering: -60, url: null }),
  useAudioPlayer: () => ({ play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(() => Promise.resolve()) }),
  useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 0, isLoaded: false }),
  RecordingPresets: { HIGH_QUALITY: {}, LOW_QUALITY: {} },
  requestRecordingPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-media-library', () => ({
  MediaType: { photo: 'photo', video: 'video' },
  SortBy: { creationTime: 'creationTime' },
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  getAssetsAsync: jest.fn(() => Promise.resolve({ assets: [], endCursor: null, hasNextPage: false })),
  getAssetInfoAsync: jest.fn((a) => Promise.resolve({ ...a, localUri: a?.uri })),
}));

jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

// SVG primitives → inert views, so components that draw art don't need native SVG.
jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Passthrough = ({ children }) => React.createElement(View, null, children);
  const Empty = () => null;
  return {
    __esModule: true, default: Passthrough, Svg: Passthrough, G: Passthrough,
    Path: Empty, Defs: Empty, LinearGradient: Empty, Stop: Empty, Rect: Empty,
    Circle: Empty, ClipPath: Empty, Use: Empty, Text: Empty, Polygon: Empty,
  };
});
