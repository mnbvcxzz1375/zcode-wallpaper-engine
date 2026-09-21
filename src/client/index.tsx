/**
 * zcode-wallpaper-engine — client entry.
 *
 * ZCode has no out-of-tree client module loader (unlike DSH's dsh.client), so
 * the built bundle is injected into the page as a plain <script> (see
 * scripts/install-to-zcode.mjs) and bootstraps itself on load. Everything it
 * mounts lives in its own DOM nodes under <body> and in its own React root, so
 * it never touches ZCode internals — the only host contact is the CSS token
 * override plus the same-origin /wallpaper-engine routes.
 */
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import stylesCss from "./styles.css?inline";
import componentsCss from "./components.css?inline";
import { Store } from "./store.js";
import { applyEffects, clearEffects, weBatteryState } from "./effects.js";
import { releaseAll, setInventoryLookup, syncLayers } from "./layer.js";
import { seedRotationFromPlaylists, stopRotation, syncRotation } from "./rotation.js";
import { startTranscodeUpgrade, stopTranscodeUpgrade } from "./transcode.js";
import { Panel } from "./components/Panel.js";
import { Picker } from "./components/Picker.js";
import { Launcher } from "./components/Launcher.js";

const ROOT_ID = "zcode-wallpaper-engine-root";
const TAG_ID = "zcode-wallpaper-engine/styles-v1";

export function apply(): () => void {
  injectStyles();

  const store = new Store();
  setInventoryLookup((id) => store.inventory?.wallpapers.find((w) => w.id === id) ?? null);

  // ── host → client ────────────────────────────────────────────────────────
  // Settings first (host file, port-independent), then inventory — so the
  // selection restore in loadInventory sees the persisted id.
  void store.hydrate().then(() => {
    void store.loadInventory().then(() => seedRotationFromPlaylists(store));
  });

  // ── React surface: launcher + panel + picker, one root ─────────────────────
  let host = document.getElementById(ROOT_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = ROOT_ID;
    document.body.appendChild(host);
  }
  const root = createRoot(host);
  const render = () => {
    root.render(
      <StrictMode>
        <Shell store={store} />
      </StrictMode>,
    );
  };
  render();
  const unsub = store.subscribe(() => {
    syncLayers(store.settings);
    applyEffects(store.settings);
    syncRotation(store);
    const w = store.selectedWallpaper();
    if (w && store.settings.fpsCap) startTranscodeUpgrade(store, w);
    else stopTranscodeUpgrade();
    render();
  });

  // ── occlusion / battery / visibility: re-apply the effective play state ────
  const onOcclusion = () => {
    syncLayers(store.settings);
    render();
  };
  const occlusionEvents = ["visibilitychange", "blur", "focus"];
  for (const t of occlusionEvents) window.addEventListener(t, onOcclusion);
  let batteryCleanup: (() => void) | null = null;
  if (typeof navigator !== "undefined" && typeof navigator.getBattery === "function") {
    void navigator
      .getBattery()
      .then((bm) => {
        weBatteryState.battery = true;
        weBatteryState.charging = bm.charging;
        const onCharge = () => {
          weBatteryState.charging = bm.charging;
          onOcclusion();
        };
        bm.addEventListener("chargingchange", onCharge);
        batteryCleanup = () => bm.removeEventListener("chargingchange", onCharge);
        onOcclusion();
      })
      .catch(() => {
        /* battery API unavailable: the toggle is inert */
      });
  }

  // First paint.
  syncLayers(store.settings);
  applyEffects(store.settings);
  syncRotation(store);

  // ── dispose ────────────────────────────────────────────────────────────────
  return () => {
    unsub();
    for (const t of occlusionEvents) window.removeEventListener(t, onOcclusion);
    if (batteryCleanup) batteryCleanup();
    stopRotation();
    stopTranscodeUpgrade();
    releaseAll();
    clearEffects();
    try {
      root.unmount();
    } catch {
      /* already gone */
    }
    if (host.parentNode) host.parentNode.removeChild(host);
  };
}

function Shell({ store }: { store: Store }) {
  return (
    <>
      <Launcher store={store} />
      {store.ui.panelOpen && <Panel store={store} />}
      {store.ui.pickerOpen && <Picker store={store} />}
    </>
  );
}

function injectStyles(): void {
  const sheets = [stylesCss, componentsCss];

  if (document.querySelector(`style[data-plugin-css="${TAG_ID}"]`)) return;
  // styles.css / components.css are already imported by the bundle; this tag
  // exists so a page carrying an older bundle's stylesheet can be detected and
  // the CSS re-injected deterministically after an upgrade.
  const tag = document.createElement("style");
  tag.dataset.pluginCss = TAG_ID;
  tag.textContent = sheets.join("\n");
  document.head.appendChild(tag);
}

// Auto-bootstrap when injected as a plain <script> (the ZCode integration). In
// module contexts (tests) the caller imports apply() and controls the lifetime.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const auto = (() => {
    try {
      return new URLSearchParams(window.location.search).get("we-disable") !== "1";
    } catch {
      return true;
    }
  })();
  if (auto) {
    const start = () => {
      try {
        apply();
      } catch (e) {
        // Never break the workbench: a failed plugin must be silent.
        console.warn("[zcode-wallpaper-engine] bootstrap failed:", e);
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  }
}

export { Store } from "./store.js";
export type { Settings, Wallpaper, Inventory } from "./types.js";
