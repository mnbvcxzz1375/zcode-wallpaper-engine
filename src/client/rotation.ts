/**
 * Automatic rotation (轮播) over user-defined lists.
 *
 * Rotation never depends on Wallpaper Engine's own playlist paths: the user
 * builds arbitrary lists from the inventory, each with its own interval and
 * order. On first run, a playable WE playlist is imported as the seed list so
 * the feature works out of the box (same UX as the upstream port).
 */
import type { Store } from "./store.js";
import type { RotationGroup } from "./types.js";

let timer: ReturnType<typeof setTimeout> | null = null;

export function syncRotation(store: Store): void {
  stopRotation();
  const s = store.settings;
  if (!s.rotationEnabled) return;
  const group = s.rotationGroups.find((g) => g.id === s.rotationGroupId) || s.rotationGroups[0];
  if (!group || group.wallpaperIds.length === 0) return;

  const candidates = group.wallpaperIds.filter((id) => {
    const w = store.inventory?.wallpapers.find((x) => x.id === id);
    return w ? store.passesFilters(w) : false;
  });
  if (candidates.length === 0) return;

  const intervalSec = Math.max(5, Math.min(86400, group.intervalSec || 300));
  const pick = () => {
    const list = group.order === "random" ? shuffled(candidates) : candidates;
    const current = s.wallpaperId;
    for (const id of list) {
      if (id !== current) return id;
    }
    return list[0];
  };
  const tick = () => {
    const next = pick();
    if (next && next !== store.settings.wallpaperId) store.patch({ wallpaperId: next });
    timer = setTimeout(tick, intervalSec * 1000);
  };
  timer = setTimeout(tick, intervalSec * 1000);
}

export function stopRotation(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Seed the first rotation group from a WE playlist (idempotent). */
export function seedRotationFromPlaylists(store: Store): void {
  const s = store.settings;
  if (s.rotationGroups.length > 0) return;
  const inv = store.inventory;
  if (!inv || inv.playlists.length === 0) return;
  const playable = new Set(inv.wallpapers.filter((w) => w.playable).map((w) => w.id));
  const pl = inv.playlists.find((p) => p.portableCount > 0);
  if (!pl) return;
  const ids = pl.wallpaperIds.filter((id) => playable.has(id));
  if (ids.length < 2) return;
  const group: RotationGroup = {
    id: `seed-${pl.id}`,
    name: pl.name,
    wallpaperIds: ids,
    intervalSec: pl.delay && pl.delay > 0 ? pl.delay : 300,
    order: pl.order === "random" ? "random" : "sequence",
  };
  store.patch({ rotationGroups: [group], rotationGroupId: group.id });
}
