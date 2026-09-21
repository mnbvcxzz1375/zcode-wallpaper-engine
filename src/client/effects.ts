/**
 * Effect application: translates settings into CSS custom properties and the
 * `data-we-wallpaper` attribute on <html>.
 *
 * ZCode renders its surfaces from Tailwind v4 tokens (--color-background,
 * --color-surface, …). Rather than patching component classes, we override the
 * tokens themselves while a wallpaper is active: the whole app becomes
 * transparent and the scrim (behind everything) provides the backdrop, while
 * the 玻璃 slider turns those same surfaces into frosted glass via
 * backdrop-filter. This is the same token-override strategy the upstream port
 * uses against DSH's --dsw-alias-bg-base.
 */
import type { Settings } from "./types.js";

const ACTIVE_ATTR = "data-we-wallpaper";

export function applyEffects(s: Settings): void {
  const root = document.documentElement;
  try {
    const hasWallpaper = Boolean(s.wallpaperId);
    if (hasWallpaper) root.setAttribute(ACTIVE_ATTR, "on");
    else root.removeAttribute(ACTIVE_ATTR);

    // ── 壁纸层滤镜：模糊 / 亮度 / 对比度 / 饱和度 / 透明度 / 翻转 ──
    root.style.setProperty("--we-wallpaper-blur", `${px(s.wallpaperBlur)}px`);
    root.style.setProperty(
      "--we-wallpaper-filter",
      [
        s.brightness !== 1 ? `brightness(${s.brightness})` : "",
        s.contrast !== 1 ? `contrast(${s.contrast})` : "",
        s.saturate !== 1 ? `saturate(${s.saturate})` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    root.style.setProperty("--we-wallpaper-opacity", String(s.wallpaperOpacity));
    root.style.setProperty("--we-flip", s.flip ? "-1" : "1");

    // ── 遮罩（暗化）：壁纸与文字之间的对比度由 scrim 承担 ──
    root.style.setProperty("--we-scrim-color", scrimColor(s.scrim));
    root.style.setProperty("--we-border-alpha", String(s.border));

    // ── 液态玻璃：模糊半径 + 玻璃底色 + 玻璃透明度 + 配色 ──
    root.style.setProperty("--we-blur", `${px(s.glass)}px`);
    root.style.setProperty(
      "--we-glass-opacity",
      String(clamp(s.glassOpacity, 0, 0.6, 0.28)),
    );
    root.style.setProperty("--we-glass-color", s.glassColor || "#ffffff");
    root.style.setProperty("--we-accent", s.accent || "#7c6cff");

    // ── 字体自定义（总开关关闭时全部回退原生）──
    if (s.fontEnabled) {
      if (s.fontColor) root.style.setProperty("--we-font-color", s.fontColor);
      else root.style.removeProperty("--we-font-color");
      if (s.fontWeight) root.style.setProperty("--we-font-weight", String(s.fontWeight));
      else root.style.removeProperty("--we-font-weight");
      if (s.fontFamily && s.fontFamily !== "inherit") {
        root.style.setProperty("--we-font-family", `"${s.fontFamily}"`);
      } else {
        root.style.removeProperty("--we-font-family");
      }
    } else {
      root.style.removeProperty("--we-font-color");
      root.style.removeProperty("--we-font-weight");
      root.style.removeProperty("--we-font-family");
    }
    if (s.cursorColor) root.style.setProperty("--we-cursor-color", s.cursorColor);
    else root.style.removeProperty("--we-cursor-color");
  } catch {
    /* never let styling throw into the workbench */
  }
}

export function clearEffects(): void {
  const root = document.documentElement;
  root.removeAttribute(ACTIVE_ATTR);
  for (const k of [
    "--we-wallpaper-blur",
    "--we-wallpaper-filter",
    "--we-wallpaper-opacity",
    "--we-flip",
    "--we-scrim-color",
    "--we-border-alpha",
    "--we-blur",
    "--we-glass-opacity",
    "--we-glass-color",
    "--we-accent",
    "--we-font-color",
    "--we-font-weight",
    "--we-font-family",
    "--we-cursor-color",
  ]) {
    root.style.removeProperty(k);
  }
}

/**
 * Occlusion pause (省电三档). The browser cannot detect "another window covers
 * the workbench", so the three closest signals are used — page hidden
 * (minimised / tab switched), window blurred, and battery power. The video is
 * explicitly paused (browser throttling of background pages does not reliably
 * stop video decode), and resumed when any of them clears — unless the user
 * paused manually.
 */
export function occlusionActive(s: Settings): boolean {
  if (document.hidden && s.pauseOnHidden) return true;
  if (!hasFocus() && s.pauseOnBlur) return true;
  if (s.pauseOnBattery && weBatteryState.battery && !weBatteryState.charging) {
    return true;
  }
  return false;
}

export const weBatteryState = { battery: false, charging: true };

let _focused = typeof document !== "undefined" ? document.hasFocus() : true;
if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    _focused = true;
  });
  window.addEventListener("blur", () => {
    _focused = false;
  });
}
function hasFocus(): boolean {
  return _focused;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function px(n: number): number {
  return Math.max(0, Math.min(120, Number(n) || 0));
}
function clamp(n: number, lo: number, hi: number, fallback: number): number {
  return typeof n === "number" && n >= lo && n <= hi ? n : fallback;
}
function scrimColor(strength: number): string {
  const a = clamp(strength, 0, 1, 0.18);
  // Dark scrim that still lets the wallpaper's colour through the glass.
  return `rgba(8, 10, 16, ${a})`;
}
