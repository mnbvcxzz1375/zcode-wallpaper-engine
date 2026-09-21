/**
 * Shared client types. Mirror the host's inventory payload
 * (lib/host.js → GET /wallpaper-engine/inventory) and the persisted settings
 * object stored in ~/.zcode-wallpaper-engine/config.json.
 */

export type WallpaperType = "scene" | "video" | "web" | "application";
export type ContentRating = "Everyone" | "PG13" | "Mature" | string | null;
export type RatingFilter = "all" | "everyone" | "pg13" | "mature" | "unrated";
export type TypeFilter = "all" | "video" | "web" | "image" | "scene";
export type ObjectFit = "cover" | "contain" | "center" | "fill";

export interface Wallpaper {
  id: string;
  title: string;
  type: WallpaperType;
  contentrating: ContentRating;
  playable: boolean;
  media: string | null;
  preview: string | null;
  frameUrl?: string | null;
  sceneUrl?: string | null;
  sceneVideo?: string | null;
  sceneAudio?: string | null;
  hasCustomFrame?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  order: "sequence" | "random";
  delay: number | null;
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
  wallpapers: Wallpaper[];
  playlists: Playlist[];
}

export interface RotationGroup {
  id: string;
  name: string;
  wallpaperIds: string[];
  intervalSec: number;
  order: "sequence" | "random";
}

export interface MediaInfo {
  ok: boolean;
  info: {
    width?: number;
    height?: number;
    codec?: string;
    fps?: number;
    duration?: number;
  } | null;
}

export interface TranscodeProgress {
  phase: "idle" | "download" | "transcode" | "done" | "error";
  percent: number;
  source: string;
  finalizing: boolean;
  eta: number | null;
}

/**
 * Persisted settings. The host sanitises every field on PUT
 * (lib/host.js sanitizeSettings) — this object is the authoritative shape both
 * sides agree on.
 */
export interface Settings {
  wallpaperId: string | null;
  paused: boolean;
  // 效果
  wallpaperBlur: number; // px
  scrim: number; // 0..1
  wallpaperOpacity: number; // 0..1 (壁纸透明度)
  brightness: number; // 0.2..2
  contrast: number;
  saturate: number;
  border: number; // 0..1
  glass: number; // px blur on panels
  dim: number; // legacy alias of scrim kept for migration
  objectFit: ObjectFit;
  flip: boolean;
  rate: number; // 0.5..2
  fpsCap: number; // 0 | 60 | 48 | 30 | 24
  // 外观
  accent: string;
  glassColor: string;
  glassOpacity: number; // 0..0.6
  // 字体
  fontEnabled: boolean;
  fontColor: string | null;
  fontWeight: number | null;
  fontFamily: string | null;
  cursorColor: string | null;
  // 布局 / 高级
  compact: boolean;
  edgeCompat: boolean;
  // 遮挡暂停
  pauseOnHidden: boolean;
  pauseOnBlur: boolean;
  pauseOnBattery: boolean;
  // 筛选
  ratingFilter: RatingFilter;
  typeFilter: TypeFilter;
  hiddenIds: string[];
  // 轮播
  rotationGroups: RotationGroup[];
  rotationEnabled: boolean;
  rotationGroupId: string | null;
  // 上传目录（host 侧权威，这里仅回显）
  uploadDir?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  wallpaperId: null,
  paused: false,
  wallpaperBlur: 0,
  scrim: 0.18,
  wallpaperOpacity: 1,
  brightness: 1,
  contrast: 1,
  saturate: 1,
  border: 0,
  glass: 18,
  dim: 0,
  objectFit: "cover",
  flip: false,
  rate: 1,
  fpsCap: 0,
  accent: "#7c6cff",
  glassColor: "#ffffff",
  glassOpacity: 0.28,
  fontEnabled: false,
  fontColor: null,
  fontWeight: null,
  fontFamily: null,
  cursorColor: null,
  compact: false,
  edgeCompat: true,
  pauseOnHidden: true,
  pauseOnBlur: false,
  pauseOnBattery: false,
  ratingFilter: "everyone",
  typeFilter: "all",
  hiddenIds: [],
  rotationGroups: [],
  rotationEnabled: false,
  rotationGroupId: null,
};
