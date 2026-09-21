/**
 * Floating launcher button — the ZCode workbench has no first-class settings
 * slot for out-of-tree panels (unlike DSH's settings.section), so the panel is
 * surfaced as a draggable glass button at the viewport edge. Click toggles the
 * panel; long-drag repositions it.
 */
import { useEffect, useState } from "react";
import type { Store } from "../store.js";

const POS_KEY = "zcode-wallpaper-engine:launcher-pos";

export function Launcher({ store }: { store: Store }) {
  const [pos, setPos] = useState(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* default position */
    }
    return { x: window.innerWidth - 64, y: Math.round(window.innerHeight * 0.72) };
  });

  useEffect(() => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  }, [pos]);

  const onPointerDown = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { ...pos };
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (!moved) return;
      setPos({
        x: clamp(origin.x + dx, 8, window.innerWidth - 48),
        y: clamp(origin.y + dy, 8, window.innerHeight - 48),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) store.ui.panelOpen = !store.ui.panelOpen;
      store.emit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const active = Boolean(store.settings.wallpaperId);
  return (
    <button
      className="we-launcher"
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={onPointerDown}
      title="Wallpaper Engine"
      aria-label="Wallpaper Engine"
      data-active={active ? "on" : "off"}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path d="M4 15l4.5-4.5 3 3L16 9l4 4" stroke="currentColor" strokeWidth="1.6" fill="none" />
        <circle cx="9" cy="8.5" r="1.4" fill="currentColor" />
      </svg>
    </button>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
