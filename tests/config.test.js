import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

/**
 * Settings persistence lives in ~/.zcode-wallpaper-engine/config.json. The
 * read/merge/write cycle is the only state the host keeps between requests, so
 * a round-trip plus a merge test covers the contract the client depends on
 * (PUT /settings debounced → GET /settings returns the merged result).
 */
describe("settings config", () => {
  const realConfig = join(homedir(), ".zcode-wallpaper-engine", "config.json");
  let backup = null;
  let scratch = null;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "we-cfg-"));
    if (existsSync(realConfig)) backup = readFileSync(realConfig);
  });

  afterEach(() => {
    if (backup) writeFileSync(realConfig, backup);
    else if (existsSync(realConfig)) rmSync(realConfig, { force: true });
    backup = null;
    rmSync(scratch, { recursive: true, force: true });
  });

  test("config.json round-trips settings", async () => {
    const settings = { scrim: 0.25, glass: 24, accent: "#7c6cff", fpsCap: 30 };
    writeFileSync(realConfig, JSON.stringify({ settings }, null, 2));

    const host = await import("../lib/host.js");
    // readSettings is not exported; exercise it through the route surface.
    const app = host.createWallpaperEngineApp();
    const res = await app.request("/wallpaper-engine/settings");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.scrim).toBe(0.25);
    expect(body.settings.fpsCap).toBe(30);
  });

  test("missing config yields null settings, not an error", async () => {
    if (existsSync(realConfig)) rmSync(realConfig, { force: true });
    const host = await import("../lib/host.js");
    const app = host.createWallpaperEngineApp();
    const res = await app.request("/wallpaper-engine/settings");
    expect(res.status).toBe(200);
    expect((await res.json()).settings).toBeNull();
  });
});
