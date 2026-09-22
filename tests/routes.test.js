import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

/**
 * Route smoke tests. The 19 routes are the entire host contract; these cover
 * the ones the client hits on every load plus the token gate that keeps an
 * arbitrary filesystem path from being served to a networked host.
 *
 * `createWallpaperEngineApp()` builds the same route table ZCode mounts, so a
 * 200 here means the mounted app serves the same shape.
 */
describe("routes", () => {
  let scratch = null;
  let uploads = null;
  const realConfig = join(homedir(), ".zcode-wallpaper-engine", "config.json");
  let backup = null;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "we-routes-"));
    uploads = join(scratch, "uploads");
    mkdirSync(uploads, { recursive: true });
    delete process.env.ZCODE_WE_UPLOAD_DIR;
    if (existsSync(realConfig)) backup = readFileSync(realConfig);
  });

  afterEach(() => {
    delete process.env.ZCODE_WE_UPLOAD_DIR;
    if (backup) writeFileSync(realConfig, backup);
    else if (existsSync(realConfig)) rmSync(realConfig, { force: true });
    backup = null;
    rmSync(scratch, { recursive: true, force: true });
  });

  let host = null;
  beforeEach(async () => {
    // The host reads ZCODE_WE_UPLOAD_DIR at module load, so set it before the
    // first import and clear the module cache between tests: each test then
    // gets a fresh route table pointing at its own scratch uploads dir.
    process.env.ZCODE_WE_UPLOAD_DIR = join(scratch, "uploads");
    vi.resetModules();
    host = await import("../lib/host.js");
  });

  function app() {
    return host.createWallpaperEngineApp();
  }

  test("GET /wallpaper-engine/inventory → 200 with the expected shape", async () => {
    const res = await (await app()).request("/wallpaper-engine/inventory");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("wallpapers");
    expect(body).toHaveProperty("playlists");
    expect(body).toHaveProperty("uploadDir");
    expect(body).toHaveProperty("total");
    expect(Array.isArray(body.wallpapers)).toBe(true);
  });

  test("PUT /wallpaper-engine/settings persists and GET echoes it back", async () => {
    const a = await app();
    // The body is the settings object itself (the client PUTs its whole store,
    // the route replaces rather than merges), so send the fields we assert on.
    // Field names are the CLIENT ones (src/client/types.ts).
    const put = await a.request("/wallpaper-engine/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scrim: 0.4,
        accent: "#ff0000",
        glass: 30,
        wallpaperId: "wp-1",
        paused: true,
        rate: 1.5,
        ratingFilter: "pg13",
        rotationGroups: [{ id: "g1", name: "夜", intervalSec: 120, order: "random", wallpaperIds: ["a", "b"] }],
        rotationGroupId: "g1",
      }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()).ok).toBe(true);

    // A second app instance reads the same config.json — persistence is real,
    // not in-memory state of the route table.
    const get = await (await app()).request("/wallpaper-engine/settings");
    const body = await get.json();
    expect(body.settings.scrim).toBe(0.4);
    expect(body.settings.accent).toBe("#ff0000");
    expect(body.settings.glass).toBe(30);
    expect(body.settings.wallpaperId).toBe("wp-1");
    expect(body.settings.paused).toBe(true);
    expect(body.settings.rate).toBe(1.5);
    expect(body.settings.ratingFilter).toBe("pg13");
    expect(body.settings.rotationGroups[0].intervalSec).toBe(120);
    expect(body.settings.rotationGroupId).toBe("g1");
  });

  test("PUT /wallpaper-engine/settings migrates legacy host field names", async () => {
    const a = await app();
    const put = await a.request("/wallpaper-engine/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playbackRate: 1.25,
        blur: 24,
        contentRatingFilter: "mature",
        glassAlpha: 40,
        backgroundBrightness: 120,
        rotationGroups: [{ id: "g", name: "old", interval: 5, order: "sequence", wallpaperIds: ["x"] }],
      }),
    });
    expect(put.status).toBe(200);
    const body = await (await put.json()).settings;
    expect(body.rate).toBe(1.25);
    expect(body.glass).toBe(24);
    expect(body.ratingFilter).toBe("mature");
    expect(body.glassOpacity).toBe(0.4);
    expect(body.brightness).toBe(1.2);
    expect(body.rotationGroups[0].intervalSec).toBe(300);
  });

  test("PUT /wallpaper-engine/settings rejects malformed JSON with 400, not a crash", async () => {
    const res = await (await app()).request("/wallpaper-engine/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    // The route still answers JSON so the client can surface the error.
    expect((await res.json())).toHaveProperty("error");
  });

  test("GET /wallpaper-engine/media-info/<unknown-token> → 404", async () => {
    const res = await (await app()).request("/wallpaper-engine/media-info/bogus");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("unknown-token");
  });

  test("POST /wallpaper-engine/upload stores a file and reports it in inventory", async () => {
    const a = await app();
    // Raw body (not multipart); the title rides in a query param so the stored
    // filename stays host-generated and unforgeable.
    const res = await a.request("/wallpaper-engine/upload?title=test.png", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array([1, 2, 3, 4]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("image");
    expect(body.playable).toBe(true);
    expect(body.media).toMatch(/\/wallpaper-engine\/media\//);

    const inv = await (await a.request("/wallpaper-engine/inventory")).json();
    const found = inv.wallpapers.find((w) => w.title === "test.png");
    expect(found, "uploaded wallpaper must appear in the inventory").toBeTruthy();
    expect(found.type).toBe("image");
  });

  test("uploading identical bytes twice dedups instead of duplicating", async () => {
    const a = await app();
    const bytes = new Uint8Array([7, 7, 7, 7]);
    const first = await (
      await a.request("/wallpaper-engine/upload?title=dup.png", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: bytes,
      })
    ).json();
    const second = await (
      await a.request("/wallpaper-engine/upload?title=dup.png", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: bytes,
      })
    ).json();

    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);

    const inv = await (await a.request("/wallpaper-engine/inventory")).json();
    const matches = inv.wallpapers.filter((w) => w.title === "dup.png");
    // sha256 dedup must keep exactly one entry for identical content.
    expect(matches).toHaveLength(1);
  });

  test("an unsupported content type is rejected with 415", async () => {
    const res = await (await app()).request("/wallpaper-engine/upload?title=x.txt", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "nope",
    });
    expect(res.status).toBe(415);
    expect((await res.json()).error).toMatch(/JPG|PNG|MP4/);
  });

  test("POST /wallpaper-engine/remove deletes an uploaded wallpaper", async () => {
    const a = await app();
    const up = await (
      await a.request("/wallpaper-engine/upload?title=gone.png", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array([9, 9]),
      })
    ).json();
    expect(up.id).toBeTruthy();

    const res = await a.request("/wallpaper-engine/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: up.id }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).removed).toBe(true);

    const inv = await (await a.request("/wallpaper-engine/inventory")).json();
    expect(inv.wallpapers.find((w) => w.title === "gone.png")).toBeUndefined();
  });

  test("remove rejects a foreign id (no path traversal)", async () => {
    const a = await app();
    const res = await a.request("/wallpaper-engine/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "../../etc/passwd" }),
    });
    expect(res.status).toBe(400);
  });

  test("unmounted path is not swallowed by the engine", async () => {
    const res = await (await app()).request("/wallpaper-engine/nope");
    expect(res.status).toBe(404);
  });
});

describe("auth token gate", () => {
  let scratch = null;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "we-auth-"));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test("a token gates every route and the query param satisfies it", async () => {
    const host = await import("../lib/host.js");
    const app = host.createWallpaperEngineApp({ authToken: "s3cret" });

    const blocked = await app.request("/wallpaper-engine/inventory");
    expect(blocked.status).toBe(401);

    const allowed = await app.request("/wallpaper-engine/inventory?token=s3cret");
    expect(allowed.status).toBe(200);
  });

  test("a wrong token is still rejected", async () => {
    const host = await import("../lib/host.js");
    const app = host.createWallpaperEngineApp({ authToken: "s3cret" });
    expect((await app.request("/wallpaper-engine/inventory?token=nope")).status).toBe(401);
  });
});
