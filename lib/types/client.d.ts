/**
 * Type declarations for the client half — `@zcode/wallpaper-engine/client`.
 *
 * lib/client.js is a Vite build artifact (one self-running IIFE, React
 * bundled, CSS inlined as strings). It is injected into ZCode's index.html as
 * a plain <script>, so in a module context you import `apply` and own the
 * lifetime; in the page it bootstraps itself.
 */

/**
 * Mount the client: injects the stylesheets, creates the React root, starts
 * the inventory/settings polling, the rotation timer and the transcode
 * upgrader.
 *
 * @returns A disposer that unmounts the root and tears down every timer,
 *          observer and media element the client started. Never throws — a
 *          failed plugin must not take the workbench down with it.
 *
 * @example
 * ```ts
 * import { apply } from "@zcode/wallpaper-engine/client";
 * const dispose = apply();
 * ```
 */
export function apply(): () => void;

/**
 * The client's state store. Exported for tests that want to drive the
 * host/client contract without a DOM.
 */
export class Store {
  inventory: Inventory | null;
  settings: WallpaperEngineSettings | null;
  ui: { panelOpen: boolean; pickerOpen: boolean };
  hydrate(): Promise<void>;
  loadInventory(): Promise<void>;
  saveSettings(next: Partial<WallpaperEngineSettings>): Promise<void>;
}

/**
 * The query string that disables the client: `?we-disable=1`. Present so the
 * workbench stays usable when a wallpaper is misbehaving.
 */
export const DISABLE_QUERY: "we-disable";

/** The id of the DOM node the client mounts its React root under. */
export const ROOT_ID: "zcode-wallpaper-engine-root";

/** The data-plugin-css tag id the injected <style> element carries. */
export const TAG_ID: "zcode-wallpaper-engine/styles-v1";

export interface Inventory {
  installDir: string | null;
  uploadDir: string;
  total: number;
  portableCount: number;
  wallpapers: InventoryWallpaper[];
  playlists: InventoryPlaylist[];
}

export interface InventoryWallpaper {
  id: string;
  title: string;
  contentrating: string | null;
  type: "video" | "image" | "scene" | "web" | "application";
  playable: boolean;
  media: string | null;
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
