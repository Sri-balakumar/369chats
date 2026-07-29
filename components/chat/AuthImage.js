// AuthImage — an <Image> for cookie-authenticated media.
//
// /chats_369/media/<id> is auth='user'. React Native's <Image> fetches through
// the platform image pipeline (Fresco on Android), which keeps its OWN cookie
// store — it does not share the one axios writes to. So a plain
// <Image source={{uri}}> against that route silently renders nothing: no error,
// no broken-image icon, just an empty frame. That is exactly how "images stopped
// loading" looks.
//
// The fix is the same one AudioBubble and MediaViewer use: fetch the bytes
// through fetch() (which DOES use the shared cookie jar), write them to the
// cache directory, and point <Image> at the local file. Downloads are
// deduplicated in-flight and cached on disk, so a thread that scrolls past the
// same photo repeatedly fetches it once.
import React, { useState, useEffect, useRef } from 'react';
import { View, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import downloadAuthed, { safeName } from '../../utils/downloadAuthed';
import { COLORS, themed } from '../../theme';
import { createLogger } from '../../api/logger';

const log = createLogger('AuthImage');

// Remote URL → local file URI, for this app run. Survives remounts as the list
// recycles rows, which is what stops a scroll from re-fetching.
const CACHE = new Map();
// Remote URL → in-flight promise, so two rows mounting at once fetch once.
const INFLIGHT = new Map();

async function localFor(url, id, mimetype) {
  if (CACHE.has(url)) return CACHE.get(url);
  if (INFLIGHT.has(url)) return INFLIGHT.get(url);

  const p = (async () => {
    const target = FileSystem.cacheDirectory + safeName(null, mimetype || 'image/jpeg', id ?? Math.abs(hash(url)));
    const uri = await downloadAuthed(url, target);
    CACHE.set(url, uri);
    return uri;
  })().finally(() => INFLIGHT.delete(url));

  INFLIGHT.set(url, p);
  return p;
}

// Only used to name a cache file when there is no message id.
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export default function AuthImage({ uri, id, mimetype, style, resizeMode = 'cover' }) {
  const [local, setLocal] = useState(() => CACHE.get(uri) || null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (!uri) return;
    const cached = CACHE.get(uri);
    if (cached) { setLocal(cached); setFailed(false); return; }
    setLocal(null);
    setFailed(false);
    localFor(uri, id, mimetype)
      .then((u) => { if (alive.current) setLocal(u); })
      .catch((e) => {
        log.warn('image fetch failed', e?.message);
        if (alive.current) setFailed(true);
      });
  }, [uri, id, mimetype]);

  if (failed) {
    return (
      <View style={[style, s.center]}>
        <Ionicons name="image-outline" size={26} color={COLORS.slate400} />
      </View>
    );
  }
  if (!local) {
    return (
      <View style={[style, s.center]}>
        <ActivityIndicator size="small" color={COLORS.slate400} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: local }}
      style={style}
      resizeMode={resizeMode}
      onError={() => setFailed(true)}
    />
  );
}

const s = themed((C) => ({
  center: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.slate100 },
}));
