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
  id: string;
  scrim: number;
  border: number;
  blur: number;
  wallpaperBlur: number;
  backgroundBrightness: number;
  backgroundContrast: number;
  backgroundSaturate: number;
  rotationEnabled: boolean;
  rotationGroupId: string;
  rotationGroups: RotationGroup[];
  rotationSeeded: boolean;
  hiddenIds: string[];
  playbackRate: number;
  videoVolume: number;
  videoAudioEnabled: boolean;
  fpsCap: number;
  betaSceneAnim: boolean;
  pauseOnHidden: boolean;
  pauseOnBlur: boolean;
  pauseOnBattery: boolean;
  flip: boolean;
  objectFit: "cover" | "contain" | "fill";
  betterSidebar: boolean;
}

export interface RotationGroup {
  id: string;
  name: string;
  interval: number;
  order: "sequence" | "random";
  wallpaperIds: string[];
}
