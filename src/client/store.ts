/**
 * Client state store.
 *
 * Two sources of truth, in order of authority:
 *   1. The host file ~/.zcode-wallpaper-engine/config.json, read on boot and
 *      written (debounced, 200ms) on every change. Port-independent: it
 *      survives `zcode --web` picking a new free port, clearing browser data
 *      and switching browsers — the reason dsh moved settings off localStorage.
 *   2. A localStorage mirror, used only so the very first paint (before the
 *      GET /settings round-trip resolves) can already restore the previous
 *      selection.
 *
 * The store is framework-agnostic: `subscribe` fires on every change and the
 * layer/effects modules re-render from it.
 */
import { HostApi } from "./api.js";
import {
  DEFAULT_SETTINGS,
  type Inventory,
  type Settings,
  type Wallpaper,
} from "./types.js";

const LS_KEY = "zcode-wallpaper-engine:settings";
const WRITE_DEBOUNCE_MS = 200;

type Listener = () => void;

export class Store {
  readonly api = new HostApi();
  settings: Settings = { ...DEFAULT_SETTINGS };
  inventory: Inventory | null = null;
  /** Set once the host settings round-trip resolves. */
  hydrated = false;
  /** UI-only state (panel open, picker tab) — never persisted to the host. */
  ui = { panelOpen: false, pickerOpen: false, tab: "wallpaper" as string };

  private listeners = new Set<Listener>();
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* a subscriber must never break the store */
      }
    }
  }

  /** Apply a partial patch and schedule a host write. */
  patch(partial: Partial<Settings>): void {
    this.settings = { ...this.settings, ...partial };
    this.scheduleWrite();
    this.emit();
  }

  /** Replace the whole settings object (host → client direction). */
  replace(next: Settings): void {
    this.settings = next;
    this.mirror();
    this.emit();
  }

  toggleHidden(id: string, hidden: boolean): void {
    const set = new Set(this.settings.hiddenIds);
    if (hidden) set.add(id);
    else set.delete(id);
    this.patch({ hiddenIds: [...set] });
  }

  /** wallpapers visible under the current content-rating + type filters. */
  filteredWallpapers(): Wallpaper[] {
    const inv = this.inventory;
    if (!inv) return [];
    return inv.wallpapers.filter((w) => this.passesFilters(w));
  }

  passesFilters(w: Wallpaper): boolean {
    const s = this.settings;
    if (s.hiddenIds.includes(w.id)) return false;
    if (!w.playable) return false;
    // contentrating: WE uses Everyone/PG13/Mature; uploads carry their own
    // meta and are treated as Everyone when unlabelled (host-side rule, so the
    // default filter never hides the user's own files).
    const rating = w.contentrating || "Everyone";
    if (s.ratingFilter !== "all") {
      if (s.ratingFilter === "unrated") {
        if (w.contentrating) return false;
      } else {
        const expected =
          s.ratingFilter === "everyone"
            ? "Everyone"
            : s.ratingFilter === "pg13"
              ? "PG13"
              : "Mature";
        if (rating !== expected) return false;
      }
    }
    if (s.typeFilter !== "all") {
      const kind =
        w.type === "video" ? "video" : w.type === "web" ? "web" : w.type === "scene" ? "scene" : "image";
      if (kind !== s.typeFilter) return false;
    }
    return true;
  }

  selectedWallpaper(): Wallpaper | null {
    const inv = this.inventory;
    if (!inv || !this.settings.wallpaperId) return null;
    return inv.wallpapers.find((w) => w.id === this.settings.wallpaperId) ?? null;
  }

  /** Restore selection after an inventory refresh; clears it if filtered out. */
  revalidateSelection(): void {
    const w = this.selectedWallpaper();
    if (!w) return;
    if (!this.passesFilters(w)) {
      this.patch({ wallpaperId: null });
    }
  }

  // ── persistence ──────────────────────────────────────────────────────────

  async hydrate(): Promise<void> {
    // localStorage first for an instant first paint.
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          this.settings = { ...DEFAULT_SETTINGS, ...parsed };
        }
      }
    } catch {
      /* corrupt mirror: ignore, host is authoritative */
    }

    const res = await this.api.getSettings();
    this.hydrated = true;
    if (res && res.settings) {
      this.settings = { ...DEFAULT_SETTINGS, ...res.settings };
      this.mirror();
      this.emit();
    }
  }

  async loadInventory(): Promise<void> {
    const inv = await this.api.getInventory();
    if (inv) {
      this.inventory = inv;
      this.revalidateSelection();
      this.emit();
    }
  }

  private scheduleWrite(): void {
    this.mirror();
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.dirty = true;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      if (!this.dirty) return;
      this.dirty = false;
      void this.api.putSettings(this.settings);
    }, WRITE_DEBOUNCE_MS);
  }

  private mirror(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.settings));
    } catch {
      /* quota / privacy mode: the host file is authoritative anyway */
    }
  }
}
