/**
 * The behind-everything wallpaper layer.
 *
 * DOM contract: the layer and its scrim are fixed children of <body> at
 * z-index 0; #root is promoted to z-index 1 with a transparent background
 * (see styles.css). ZCode's own UI therefore paints *over* the wallpaper while
 * its surface tokens stay transparent — the same layering the upstream port
 * uses, re-pointed at ZCode's Tailwind v4 tokens.
 *
 * Media lifecycle is strict: every element created for a wallpaper is
 * explicitly released (src = '', load() abort, remove) before the next one
 * mounts, so switching wallpapers never leaks file handles on the host
 * (Windows locks the file while a stream is open).
 */
import type { Settings, Wallpaper } from "./types.js";
import { occlusionActive } from "./effects.js";

const LAYER_ID = "zcode-wallpaper-engine-layer";
const SCRIM_ID = "zcode-wallpaper-engine-scrim";

type Kind = "video" | "web" | "image" | "iframe-scene";

interface Mounted {
  kind: Kind;
  el: HTMLElement;
  video?: HTMLVideoElement;
  /** token used for the transcode upgrade swap (see transcode.ts). */
  srcToken?: string;
}

let mounted: Mounted | null = null;
let layerEl: HTMLElement | null = null;
let scrimEl: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (layerEl && document.body.contains(layerEl)) return layerEl;
  const el = document.createElement("div");
  el.id = LAYER_ID;
  el.setAttribute("aria-hidden", "true");
  document.body.prepend(el);
  layerEl = el;
  return el;
}

function ensureScrim(): HTMLElement {
  if (scrimEl && document.body.contains(scrimEl)) return scrimEl;
  const el = document.createElement("div");
  el.id = SCRIM_ID;
  el.setAttribute("aria-hidden", "true");
  document.body.prepend(el);
  scrimEl = el;
  return el;
}

/** Release the current media element and every handle it holds. */
function releaseLayerMedia(): void {
  if (!mounted) return;
  const { el, video } = mounted;
  if (video) {
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch {
      /* already detached */
    }
  }
  const ifr = el.querySelector("iframe");
  if (ifr) {
    try {
      ifr.src = "about:blank";
    } catch {
      /* ignore */
    }
  }
  el.innerHTML = "";
  mounted = null;
}

/** Decide which representation of the wallpaper the layer should draw. */
function chooseKind(w: Wallpaper): Kind {
  if (w.type === "video") return "video";
  if (w.type === "web") return "web";
  if (w.type === "scene") {
    // Scene: the host extracts an MP4 of the scene's animated content when
    // possible (hardware-decoded, smooth); otherwise the pure-JS rendered
    // static frame; the live renderer is the last resort.
    if (w.sceneVideo) return "video";
    if (w.frameUrl) return "image";
    if (w.sceneUrl) return "iframe-scene";
    return "image";
  }
  // uploads: images serve themselves, videos play directly.
  return w.media && /\.(mp4|m4v|webm|mov|mkv|avi)$/i.test(w.media) ? "video" : "image";
}

export function syncLayers(s: Settings): void {
  const layer = ensureContainer();
  const scrim = ensureScrim();
  const w = s.wallpaperId ? findWallpaper(s.wallpaperId) : null;

  if (!w) {
    releaseLayerMedia();
    layer.classList.remove("we-active");
    scrim.classList.remove("we-active");
    return;
  }

  const kind = chooseKind(w);
  const src = resolveSrc(w, kind);

  // Reuse the running element when only its state changed (rate / pause /
  // filters) — avoids a full remount (and a decode restart) on every tick.
  if (mounted && mounted.kind === kind && mounted.srcToken === src && mounted.el.isConnected) {
    applyPlayback(mounted, s, w);
    applySizing(mounted.el, s);
    scrim.classList.add("we-active");
    return;
  }

  releaseLayerMedia();
  scrim.classList.add("we-active");
  const el = buildElement(kind, src, w, s);
  layer.appendChild(el);
  layer.classList.add("we-active");
  mounted = { kind, el, srcToken: src, video: kind === "video" ? (el as HTMLVideoElement) : undefined };
  applyPlayback(mounted, s, w);
  applySizing(el, s);
}

// inventory lookup injected by index.tsx (avoids a circular import)
let inventoryLookup: (id: string) => Wallpaper | null = () => null;
export function setInventoryLookup(fn: (id: string) => Wallpaper | null): void {
  inventoryLookup = fn;
}
function findWallpaper(id: string): Wallpaper | null {
  return inventoryLookup(id);
}

function resolveSrc(w: Wallpaper, kind: Kind): string {
  if (kind === "video") {
    // Prefer a transcode-capped variant when the host already has one; the
    // transcode module swaps this in as soon as the encode lands.
    const v = w.sceneVideo || w.media;
    return v || "";
  }
  if (kind === "web") return w.media || "";
  if (kind === "iframe-scene") return w.sceneUrl || "";
  return w.frameUrl || w.preview || w.media || "";
}

function buildElement(kind: Kind, src: string, w: Wallpaper, s: Settings): HTMLElement {
  if (kind === "video") {
    const v = document.createElement("video");
    v.className = "we-layer__media";
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = autoPlayBlocked() ? "metadata" : "auto";
    v.dataset.weToken = src;
    v.src = src;
    v.playbackRate = s.rate || 1;
    // Browsers refuse play() without a user gesture when the tab is not
    // interacted with yet; retry once metadata is ready (the most common
    // freeze cause is a src swap racing play()).
    v.addEventListener("loadedmetadata", () => {
      if (!document.hidden) void v.play().catch(() => { /* reported via state */ });
    });
    return v;
  }
  if (kind === "web" || kind === "iframe-scene") {
    const f = document.createElement("iframe");
    f.className = "we-layer__media";
    f.src = src;
    f.setAttribute("allow", "autoplay; fullscreen");
    f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-pointer-lock");
    f.dataset.weToken = src;
    return f;
  }
  const img = document.createElement("img");
  img.className = "we-layer__media";
  img.alt = "";
  img.dataset.weToken = src;
  img.src = src;
  return img;
}

function applySizing(el: HTMLElement, s: Settings): void {
  el.style.objectFit = s.objectFit || "cover";
}

function applyPlayback(m: Mounted, s: Settings, w: Wallpaper): void {
  if (m.kind !== "video" || !m.video) return;
  const v = m.video;
  if (v.playbackRate !== (s.rate || 1)) v.playbackRate = s.rate || 1;

  const userPaused = Boolean(s.paused);
  const occluded = occlusionActive(s);
  const shouldPlay = !userPaused && !occluded;
  if (shouldPlay && v.paused) {
    void v.play().catch((err) => {
      // Autoplay policy / undecodable codec: surface the real reason instead of
      // silently freezing on the first frame.
      console.warn("[zcode-wallpaper-engine] playback rejected:", err && err.message);
    });
  } else if (!shouldPlay && !v.paused) {
    v.pause();
  }
  void w; // (kept in the signature for parity with the upstream contract)
}

export function releaseAll(): void {
  releaseLayerMedia();
  if (layerEl && layerEl.parentNode) layerEl.parentNode.removeChild(layerEl);
  if (scrimEl && scrimEl.parentNode) scrimEl.parentNode.removeChild(scrimEl);
  layerEl = null;
  scrimEl = null;
}

function autoPlayBlocked(): boolean {
  try {
    return typeof navigator !== "undefined" && navigator.userActivation?.hasBeenActive === false;
  } catch {
    return false;
  }
}
