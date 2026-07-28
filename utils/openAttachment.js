// openAttachment — download a chat attachment and hand it straight to the OS.
//
// Used for video, audio and documents, where an in-app preview would need a
// player dependency. Tapping one of those in a thread runs it immediately; there
// is no intermediate "Play"/"Open" step.
//
// Images do NOT come through here — they open in MediaViewer, which shows them
// full-screen in-app.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import downloadAuthed, { safeName } from './downloadAuthed';
import { createLogger } from '../api/logger';

const log = createLogger('OpenAttachment');

// msg: the normalised message ({ id, mediaUrl, fileName, mimetype, kind }).
// share:true forces the share sheet instead of opening in a viewer.
export default async function openAttachment(msg, { share = false } = {}) {
  if (!msg?.mediaUrl) throw new Error('This attachment is not available.');

  const target = FileSystem.cacheDirectory + safeName(msg.fileName, msg.mimetype, msg.id);
  const uri = await downloadAuthed(msg.mediaUrl, target);

  if (share || Platform.OS !== 'android') {
    if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
    await Sharing.shareAsync(uri, { mimeType: msg.mimetype || undefined });
    return uri;
  }

  // Android: ACTION_VIEW opens the right player/reader directly, no share sheet.
  // It needs a content:// URI — a file:// path throws FileUriExposedException.
  const contentUri = await FileSystem.getContentUriAsync(uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1,   // FLAG_GRANT_READ_URI_PERMISSION
    type: msg.mimetype || '*/*',
  });
  log.info('opened externally', { id: msg.id, kind: msg.kind });
  return uri;
}
