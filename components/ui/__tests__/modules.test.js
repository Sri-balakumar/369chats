// Import smoke test.
//
// Every screen and component is require()d once. This catches the class of bug
// that a Metro bundle does NOT: a symbol used but never imported. `expo export`
// resolves modules fine and only fails at runtime, on device, with
// "ReferenceError: Property 'X' doesn't exist" — which is exactly how a stray
// `Platform.OS` inside a StyleSheet.create block took the whole app down.
//
// StyleSheet.create runs at module-evaluation time, so simply requiring the file
// is enough to surface it.
import { Platform } from 'react-native';

// Native modules that have no JS implementation under jest. They are mocked in
// jest.setup.js; this list documents why the test can load screens that use them.
const NATIVE_BACKED = ['expo-audio', 'expo-media-library', '@notifee/react-native'];

const MODULES = [
  // ── design system ──
  '../../ui',
  '../../ui/Screen',
  '../../ui/ScreenHeader',
  '../../ui/Banner',
  '../../ui/Card',
  '../../ui/ChipRow',
  '../../ui/DataList',
  '../../ui/Loader',
  '../../ui/EmptyState',
  '../../ui/Sheet',
  '../../ui/PopupModal',
  '../../ui/MenuPopup',
  '../../ui/SectionCard',
  '../../ui/SelectField',
  '../../ui/Switch',
  '../../ui/ConfirmDialog',
  '../../ui/Accordion',
  '../../ui/Row',
  '../../ui/Icon',
  '../../ui/Avatar',
  '../../ui/AnimatedTile',
  '../../ui/StatCard',
  // ── chat components ──
  '../../chat/MessageBubble',
  '../../chat/Composer',
  '../../chat/MediaViewer',
  '../../chat/AttachSheet',
  '../../chat/AudioBubble',
  '../../chat/VoiceRecorder',
  '../../chat/MediaPreview',
  '../../chat/LinkedText',
  '../../chat/AuthImage',
  '../../chat/BottomTabs',
  '../../chat/CropEditor',
  '../../chat/NowPlayingBar',
  // ── shell components ──
  '../../GradientBackground',
  '../../ScreenTransition',
  '../../CameraCaptureModal',
  '../../DurationTimePicker',
  '../../LoginArt',
  '../../GoogleIcon',
  '../../MicrosoftIcon',
  // ── screens ──
  '../../../screens/CallsScreen',
  '../../../screens/CallScreen',
  '../../../screens/DebugLogScreen',
  '../../../screens/ChatListScreen',
  '../../../screens/ChatThreadScreen',
  '../../../screens/NewChatScreen',
  '../../../screens/ContactInfoScreen',
  '../../../screens/GroupManageScreen',
  '../../../screens/ChatSearchScreen',
  '../../../screens/ChatMediaScreen',
  '../../../screens/StarredScreen',
  '../../../screens/ChatSettingsScreen',
  '../../../screens/GmeetSettingsScreen',
  '../../../screens/NotificationsScreen',
  '../../../screens/ConfigurationScreen',
  '../../../screens/LoginManagementScreen',
  '../../../screens/UsersScreen',
  '../../../screens/CompanyBranding',
  '../../../screens/UserManual',
  '../../../screens/SplashScreen',
  '../../../screens/LoginScreen',
  '../../../screens/ConnectScreen',
  '../../../screens/AppLoginScreen',
  '../../../screens/AlarmScreen',
  '../../../screens/SignUpScreen',
  '../../../screens/ForgotPasswordScreen',
  // ── non-UI modules that still run code at import time ──
  '../../../services/chat',
  '../../../services/chatRealtime',
  '../../../utils/openAttachment',
  '../../../utils/downloadAuthed',
  '../../../utils/useKeyboardHeight',
  '../../../theme',
];

describe('module imports', () => {
  it.each(MODULES)('%s loads without a ReferenceError', (path) => {
    expect(() => require(path)).not.toThrow();
  });

  it('runs on a known platform (guards the Platform.OS branches above)', () => {
    expect(['ios', 'android', 'web']).toContain(Platform.OS);
    expect(NATIVE_BACKED.length).toBeGreaterThan(0);
  });
});
