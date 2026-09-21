/**
 * Host API client. Every call hits the same-origin /wallpaper-engine routes
 * mounted by lib/host.js onto the ZCode server (or the standalone server).
 *
 * Errors are swallowed into a typed result rather than thrown: the client half
 * must never break the ZCode workbench when the host half is unreachable
 * (older ZCode without the patch, server restarting, …).
 */
import type {
  Inventory,
  MediaInfo,
  Settings,
  TranscodeProgress,
} from "./types.js";

const BASE = "/wallpaper-engine";

export class HostApi {
  private baseUrl: string;

  constructor(baseUrl = BASE) {
    // Honour a full origin only when explicitly constructed that way (tests);
    // in-page usage stays same-origin.
    this.baseUrl = baseUrl;
  }

  async getInventory(): Promise<Inventory | null> {
    return this.json<Inventory>(`${this.baseUrl}/inventory`);
  }

  async getSettings(): Promise<{ settings: Partial<Settings> | null } | null> {
    return this.json(`${this.baseUrl}/settings`);
  }

  async putSettings(settings: Settings): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getMediaInfo(token: string): Promise<MediaInfo | null> {
    return this.json<MediaInfo>(`${this.baseUrl}/media-info/${token}`);
  }

  async getTranscodeProgress(
    token: string,
    fps: number,
    signal?: AbortSignal,
  ): Promise<TranscodeProgress | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/transcode-progress/${token}?fps=${fps}`,
        { signal, cache: "no-store" },
      );
      if (!res.ok) return null;
      return (await res.json()) as TranscodeProgress;
    } catch {
      return null;
    }
  }

  /**
   * Upload a custom wallpaper (JPG / PNG / MP4). Raw bytes, no form encoding —
   * the host route reads the whole body.
   */
  async upload(file: File): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/upload`, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-WE-Title": encodeURIComponent(file.name),
        },
        body: file,
      });
      if (res.ok) return { ok: true };
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: String(err.error || res.statusText) };
    } catch (e) {
      return { ok: false, error: String((e as Error).message || e) };
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async setUploadDir(dir: string, migrate: boolean): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/upload-dir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir, migrate }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Build a same-origin media URL (the host already emits these). */
  mediaUrl(path: string): string {
    return path.startsWith("http") ? path : `${this.baseUrl}/${path}`;
  }

  private async json<T>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
}
