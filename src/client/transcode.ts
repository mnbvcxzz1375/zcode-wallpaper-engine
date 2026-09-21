/**
 * Decode frame-rate cap (抽帧转码).
 *
 * High-frame-rate sources (4K120 H.264) dominate GPU video-decode usage. The
 * host re-encodes such a source once, capped at the chosen frame rate (timeline
 * kept at 1.0×, fully decoupled from the playback-rate slider), and caches it.
 *
 * Client-side behaviour, matching the upstream port:
 *   1. play the ORIGINAL file first (instant first paint),
 *   2. poll /transcode-progress/<token>?fps=N every second,
 *   3. swap the running <video> src to the capped variant the moment it lands.
 * No ffmpeg on the host, or the encode fails → keep the original silently.
 */
import type { Store } from "./store.js";
import type { Wallpaper } from "./types.js";

const POLL_INTERVAL_MS = 1000;

interface Active {
  token: string;
  fps: number;
  abort: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
}

let active: Active | null = null;

export function startTranscodeUpgrade(store: Store, w: Wallpaper): void {
  const s = store.settings;
  if (!s.fpsCap) return stopTranscodeUpgrade();
  if (w.type !== "video" && !w.sceneVideo) return stopTranscodeUpgrade();

  // The token the media route uses is base64url of the absolute path — but the
  // client only ever sees the URL, so the URL's trailing segment IS the token.
  const mediaUrl = w.sceneVideo || w.media;
  if (!mediaUrl) return;
  const token = mediaUrl.split("/").pop() || "";
  if (!token) return;

  if (active && active.token === token) return;
  stopTranscodeUpgrade();

  const abort = new AbortController();
  active = { token, fps: s.fpsCap, abort, timer: null };

  // Skip when the source is already at/below the cap (host-side media-info
  // probe: moov box → width/height/codec/fps).
  void store.api.getMediaInfo(token).then((mi) => {
    if (!active || active.token !== token) return;
    if (mi && mi.info && mi.info.fps && mi.info.fps <= active.fps) {
      stopTranscodeUpgrade();
      return;
    }
    void poll();
  });

  const poll = async () => {
    if (!active || active.token !== token) return;
    const p = await store.api.getTranscodeProgress(token, s.fpsCap, abort.signal);
    if (!active || active.token !== token) return;
    if (p && p.phase === "done") {
      active = null;
      // Hand the capped variant to the layer by appending the fps hint: the
      // host serves the cached encode from the same route.
      swapToTranscoded(store, w, s.fpsCap);
      return;
    }
    if (p && p.phase === "error") {
      active = null;
      return;
    }
    active.timer = setTimeout(poll, POLL_INTERVAL_MS);
  };
  void poll();
}

export function stopTranscodeUpgrade(): void {
  if (!active) return;
  try {
    active.abort.abort();
  } catch {
    /* ignore */
  }
  if (active.timer) clearTimeout(active.timer);
  active = null;
}

function swapToTranscoded(store: Store, w: Wallpaper, fps: number): void {
  const mediaUrl = w.sceneVideo || w.media;
  if (!mediaUrl) return;
  // Same-origin route; the query tells the host which cached encode to serve.
  const capped = mediaUrl.includes("?")
    ? `${mediaUrl}&fps=${fps}`
    : `${mediaUrl}?fps=${fps}`;
  if (w.sceneVideo) w.sceneVideo = capped;
  else w.media = capped;
  // Force a remount so the new source is picked up.
  store.emit();
}
