import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Steam discovery is what makes the port work when Wallpaper Engine is NOT on
 * C:. libraryfolders.vdf lists every library and which apps live in it; only
 * libraries owning app 431960 count, and Windows-style paths must survive.
 *
 * ZCODE_WE_STEAM_ROOT overrides the probe list, so a synthetic Steam tree
 * exercises the real discovery path without a Steam install being present
 * (the production reality on most CI machines — which is also why the
 * empty-result path matters as much as the populated one).
 */
describe("steam discovery via ZCODE_WE_STEAM_ROOT", () => {
  let scratch = null;
  const env = "ZCODE_WE_STEAM_ROOT";

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "we-vdf-"));
    delete process.env[env];
  });

  afterEach(() => {
    delete process.env[env];
    rmSync(scratch, { recursive: true, force: true });
  });

  /** Build a synthetic Steam library tree owned by a set of app ids. */
  function makeLibrary(libPath, apps) {
    mkdirSync(join(libPath, "steamapps"), { recursive: true });
    const appLines = apps.map((id) => `\t\t\t"${id}"\t\t"1"`).join("\n");
    writeFileSync(
      join(libPath, "steamapps", "libraryfolders.vdf"),
      [
        '"libraryfolders"',
        "{",
        '\t"0"',
        "\t{",
        `\t\t"path"\t\t"${libPath.replace(/\\/g, "\\\\")}"`,
        '\t\t"apps"',
        "\t\t{",
        appLines,
        "\t\t}",
        "\t}",
        "}",
        "",
      ].join("\r\n"),
    );
  }

  test("locates the install directory of a library owning 431960", async () => {
    const lib = join(scratch, "D-SteamLibrary");
    makeLibrary(lib, ["431960"]);
    mkdirSync(join(lib, "steamapps", "common", "wallpaper_engine"), { recursive: true });
    writeFileSync(join(lib, "steamapps", "common", "wallpaper_engine", "wallpaper32.exe"), "PE");

    process.env[env] = lib;
    const host = await import("../lib/host.js");
    const app = host.createWallpaperEngineApp();
    const res = await app.request("/wallpaper-engine/inventory");
    expect(res.status).toBe(200);
    const body = await res.json();
    // The install dir is reported even though no wallpapers are enumerated yet.
    expect(body.installDir).toContain("wallpaper_engine");
  });

  test("ignores a library that does not own 431960", async () => {
    const lib = join(scratch, "E-SteamLibrary");
    makeLibrary(lib, ["730"]);
    mkdirSync(join(lib, "steamapps", "common", "wallpaper_engine"), { recursive: true });
    writeFileSync(join(lib, "steamapps", "common", "wallpaper_engine", "wallpaper32.exe"), "PE");

    process.env[env] = lib;
    const host = await import("../lib/host.js");
    const app = host.createWallpaperEngineApp();
    const res = await app.request("/wallpaper-engine/inventory");
    expect(res.status).toBe(200);
    const body = await res.json();
    // No library owns WE, so the install dir is unknown.
    expect(body.installDir).toBeNull();
  });

  test("a steam root with no vdf still answers cleanly", async () => {
    const lib = join(scratch, "empty");
    mkdirSync(lib, { recursive: true });
    process.env[env] = lib;
    const host = await import("../lib/host.js");
    const app = host.createWallpaperEngineApp();
    const res = await app.request("/wallpaper-engine/inventory");
    expect(res.status).toBe(200);
    expect((await res.json()).total).toBe(0);
  });
});
