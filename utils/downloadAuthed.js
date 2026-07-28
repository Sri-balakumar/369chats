// downloadAuthed — fetch a cookie-authenticated URL and write it to disk.
//
// /chats_369/media/<id> is auth='user'. expo-file-system's downloadAsync does
// NOT send the Odoo session cookie, so it returns 404 for every attachment;
// fetch() goes through the platform networking stack that holds the same cookie
// jar axios and <Image> use, so it authenticates like the rest of the app.
//
// The blob → dataURL → base64 hop is the only route to the filesystem without a
// native module: RN's fetch cannot stream to a file. It costs memory
// proportional to the file, which is why the server's 25 MB cap matters.
import * as FileSystem from 'expo-file-system/legacy';

// Strip anything the filesystem will object to, and guarantee an extension so
// the OS can pick a handler by type.
export function safeName(name, mimetype, id) {
  const clean = String(name || '').replace(/[^\w.\-]+/g, '_').slice(0, 80);
  if (clean && clean.includes('.')) return clean;
  const ext = (mimetype || '').split('/').pop() || 'bin';
  return `${clean || `media_${id}`}.${ext}`;
}

export default async function downloadAuthed(url, target) {
  // Already fetched this attachment in this session — reuse it.
  const existing = await FileSystem.getInfoAsync(target);
  if (existing.exists && existing.size > 0) return target;

  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    // 404 here is the server's own "no" — not a member, message deleted, or a
    // view-once already burned — not a missing file.
    throw new Error(
      res.status === 404
        ? 'This attachment is no longer available.'
        : `Server returned ${res.status}`,
    );
  }
  const blob = await res.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the download.'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
  const b64 = String(dataUrl).split(',')[1] || '';
  await FileSystem.writeAsStringAsync(target, b64, { encoding: 'base64' });
  return target;
}
