/**
 * Type declarations for @zcode/wallpaper-engine's host half.
 *
 * The runtime is plain JS (no build step on the host side); these hand the
 * ZCode integration point — and anyone importing the package — the shape of
 * the mount API without having to read lib/host.js.
 */

import type { Hono } from "hono";

/**
 * Mount the Wallpaper Engine routes onto a Hono app.
 *
 * ZCode calls this from packages/server/src/http.ts; the standalone CLI and the
 * tests call {@link createWallpaperEngineApp}, which builds its own app and
 * forwards it here.
 *
 * @param app A Hono instance — the ZCode server app, or a standalone one.
 * @param options
 * @returns A disposer: call it to unregister every route, kill in-flight
 *          ffmpeg jobs and destroy open media streams.
 *
 * @example
 * ```ts
 * import { registerWallpaperEngineRoutes } from "@zcode/wallpaper-engine";
 * const dispose = registerWallpaperEngineRoutes(app, { authToken });
 * process.on("beforeExit", () => dispose());
 * ```
 */
export function registerWallpaperEngineRoutes(
  app: Hono,
  options?: WallpaperEngineOptions,
): () => void;

/**
 * A Hono app carrying only the /wallpaper-engine routes. Used by the CLI
 * (`zcode-wallpaper-engine serve`) and by the test suite.
 */
export function createWallpaperEngineApp(options?: WallpaperEngineOptions): Hono;

/**
 * A standalone node-server instance. Resolves `hono` and `@hono/node-server`
 * from the host project — ZCode ships both.
 */
export function createStandaloneServer(options?: WallpaperEngineServerOptions): Promise<unknown>;

export interface WallpaperEngineOptions {
  /**
   * Inherit ZCode's auth gate when the server binds a non-loopback host.
   * ZCode's middleware accepts the token as a cookie or as `?token=`; passing
   * the same value here gives every /wallpaper-engine route the identical gate.
   * Loopback dev needs no token — ZCode does not set one for localhost.
   */
  authToken?: string;
}

export interface WallpaperEngineServerOptions extends WallpaperEngineOptions {
  /** Bind port. 0 (default) lets the OS choose; `ZCODE_WE_PORT` also applies. */
  port?: number;
  /** Bind host, default `127.0.0.1`. */
  host?: string;
}

/**
 * One entry in the inventory payload served by GET /wallpaper-engine/inventory.
 * Media URLs are base64url tokens, never raw paths — the token map is what
 * keeps arbitrary filesystem strings out of the URL space.
 */
export interface InventoryWallpaper {
  id: string;
  title: string;
  contentrating: string | null;
  type: "video" | "image" | "scene" | "web" | "application";
  /** Whether the client can play this entry at all (codec/container support). */
  playable: boolean;
  /** Tokenized URL of the playable media, or null when unsupported. */
  media: string | null;
  /** Tokenized URL of the preview image, or null when none exists. */
  preview: string | null;
  sceneUrl?: string | null;
  sceneVideo?: string | null;
  sceneAudio?: string | null;
  hasCustomFrame?: boolean;
}

export interface InventoryPlaylist {
  id: string;
  name: string;
  order: string;
  delay: number;
  wallpaperIds: string[];
  total: number;
  portableCount: number;
  unresolvedCount: number;
}

export interface Inventory {
  installDir: string | null;
  uploadDir: string;
  total: number;
  portableCount: number;
  wallpapers: InventoryWallpaper[];
  playlists: InventoryPlaylist[];
}

/**
 * The persisted settings object. PUT /wallpaper-engine/settings takes this
 * shape directly (not wrapped in `{ settings }`) and *replaces* rather than
 * merges — every key the client does not send falls back to its default.
 * Field names match src/client/types.ts Settings (the UI source of truth).
 */
export interface WallpaperEngineSettings {
  wallpaperId: string | null;
  paused: boolean;
  /** px blur on the wallpaper layer. */
  wallpaperBlur: number;
  /** 0..1 dark scrim between wallpaper and UI. */
  scrim: number;
  /** 0..1 wallpaper layer opacity. */
  wallpaperOpacity: number;
  /** CSS filter multipliers, 0.2..2. */
  brightness: number;
  contrast: number;
  saturate: number;
  /** 0..1 accent border alpha. */
  border: number;
  /** px backdrop blur on glass panels. */
  glass: number;
  /** legacy alias of scrim kept for migration. */
  dim: number;
  objectFit: "cover" | "contain" | "center" | "fill";
  flip: boolean;
  /** Video playback rate, 0.5..2. */
  rate: number;
  fpsCap: number;
  accent: string;
  glassColor: string;
  /** 0..0.6 glass fill alpha. */
  glassOpacity: number;
  fontEnabled: boolean;
  fontColor: string | null;
  fontWeight: number | null;
  fontFamily: string | null;
  cursorColor: string | null;
  compact: boolean;
  edgeCompat: boolean;
  pauseOnHidden: boolean;
  pauseOnBlur: boolean;
  pauseOnBattery: boolean;
  ratingFilter: "all" | "everyone" | "pg13" | "mature" | "unrated";
  typeFilter: "all" | "video" | "web" | "image" | "scene";
  hiddenIds: string[];
  rotationGroups: RotationGroup[];
  rotationEnabled: boolean;
  rotationGroupId: string | null;
}

export interface RotationGroup {
  id: string;
  name: string;
  /** Seconds per wallpaper. Clamped to [5, 86400]. */
  intervalSec: number;
  order: "sequence" | "random";
  wallpaperIds: string[];
}

export interface WallpaperEngine {
  registerWallpaperEngineRoutes: typeof registerWallpaperEngineRoutes;
  createWallpaperEngineApp: typeof createWallpaperEngineApp;
  createStandaloneServer: typeof createStandaloneServer;
}

const _default: WallpaperEngine;
export default _default;
