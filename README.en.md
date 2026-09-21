# zcode-wallpaper-engine

[中文](README.md) | English

Bring your local **Wallpaper Engine** wallpapers to the **ZCode workbench** ([zai-org/ZCode](https://github.com/zai-org/ZCode)) as the background.

Auto-discovers the local Wallpaper Engine install, lists your wallpapers, and renders the *portable* types behind the workbench UI with an **iOS-style liquid glass** effect: Video (`.mp4`) plays, Web/HTML loads in an iframe, and **Scene wallpapers are fully rendered by an in-tree pure-JS renderer**. Ported from [dsh-plugin-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine).

> **Why a port and not a plugin:** ZCode has no plugin bus (no DSH-style Cordis host, no `ctx.webServer.register`, no `slots.inject`), so the integration point differs — routes are mounted onto ZCode's Hono server and the client is injected into `index.html` at build time (see [zcode.patch.yml](zcode.patch.yml) and `scripts/install-to-zcode.mjs`). The feature set carries over.

## Feature matrix: dsh → zcode

| Upstream feature | Status | Implementation |
|---|---|---|
| Steam library auto-discovery (`libraryfolders.vdf`; non-default drives work) | ✅ | `lib/vdf.js` — Steam registry + libraryfolders.vdf; `ZCODE_WE_STEAM_ROOT` overrides |
| Wallpaper enumeration (`projects/defaultprojects`, `myprojects`, `steamapps/workshop/content/431960/*`) | ✅ | Same layout as upstream, fully async |
| Video wallpapers (`.mp4`, Range streaming) | ✅ | `/media/<token>` with `Range` support |
| Web / HTML wallpapers (iframe) | ✅ | `/media/<token>` serves the HTML |
| Scene wallpapers, full scene frame | ✅ | `lib/scene-render-worker.mjs` (worker thread) + `lib/we-renderer/` (object tree / textures / particles / shader effects / puppet skeletal meshes) |
| Scene static-frame caching (`<version>_<path>_<mtime>`) | ✅ | `~/.zcode-wallpaper-engine/cache/frames/`; mtime change invalidates |
| Scene animation (APNG / MP4 / WebM) | ✅ | `/scene-anim`; one renderer instance reused, per-frame IDAT compressed immediately, progress polling |
| Wallpaper picker (thumbnail grid) | ✅ | `src/client/components/Picker.tsx` |
| Hide / restore wallpapers (soft delete; source files untouched) | ✅ | `hiddenIds`, persisted to config.json |
| Video playback rate 0.5x–2x | ✅ | Native `playbackRate`, instant |
| Horizontal flip (video / web / uploaded images) | ✅ | CSS `scaleX(-1)` |
| Custom uploads (JPG / PNG / MP4, raw byte stream) | ✅ | `POST /upload?title=X` (**raw body, not multipart**) |
| Auto thumbnail for uploaded MP4 | ✅ | `/video-preview/<token>`; lazy ffmpeg + disk cache |
| Upload directory change with migration | ✅ | `POST /upload-dir`, persisted |
| Media metadata (resolution / codec / fps / duration; moov probe) | ✅ | `/media-info/<token>` |
| Decode fps cap (transcode; 4K kept + AV1) | ✅ | `/transcoded/<token>?fps=N` + `/transcode-progress`; ffmpeg three-tier supply (explicit → auto-download → PATH) |
| Wallpaper effects (scrim / blur / brightness / contrast / saturate / wallpaper opacity) | ✅ | CSS filter chain; instant, persisted |
| Pause-when-obscured, three tiers (minimized / unfocused / battery) | ✅ | `src/client/effects.ts`; decode drops to zero |
| Rotation (sequence / random; reads WE workshop playlists) | ✅ | `src/client/rotation.ts`, reads `playlist.json` |
| Liquid-glass settings page (accent + opacity) | ⚠️ Partial | Glass / scrim / filters / accent complete. **ZCode has no native settings window**, so upstream's "make the entire settings window liquid glass" has no host to apply to; `betterSidebar` is always `false` (`lib/host.js: isBetterSidebarLoaded`) |
| Font customization / input caret color | ❌ Not ported | These dye the host's native controls; under ZCode they would restyle something nobody looks at |
| Edge-compatible canvas rendering | ❌ Not ported | ZCode ships Chromium; the Edge download-overlay problem does not exist there |
| Settings persisted to a host-side file | ✅ | `~/.zcode-wallpaper-engine/config.json` (200 ms debounce; corrupt file falls back to defaults without overwriting) |
| Media stream handles released promptly | ✅ | Streams destroyed on client disconnect; Windows no longer locks the wallpaper files |
| WSL support (`/mnt/<drive>` detection) | ✅ | Same probing as upstream |

## Route table (19 registration sites, 20 routes)

| Method | Path | Notes |
|---|---|---|
| GET | `/wallpaper-engine/inventory` | Wallpaper JSON list (with playlists, portable counts) |
| GET | `/wallpaper-engine/settings` | Read settings |
| PUT | `/wallpaper-engine/settings` | Save settings (**body is the settings object itself, not `{settings:{}}`; it replaces rather than merges**) |
| GET | `/wallpaper-engine/media/<token>` | Video / HTML, Range supported |
| GET | `/wallpaper-engine/preview/<token>` | Preview image |
| GET | `/wallpaper-engine/video-preview/<token>` | On-demand frame for uploaded MP4 |
| GET | `/wallpaper-engine/media-info/<token>` | Media metadata via moov probe |
| GET | `/wallpaper-engine/transcoded/<token>?fps=N` | Transcoded stream |
| GET | `/wallpaper-engine/transcode-progress/<token>?fps=N` | Download / transcode progress |
| GET | `/wallpaper-engine/scene-frame/<token>` | Scene static frame (4K, PNG cached) |
| GET | `/wallpaper-engine/scene-anim/<token>?fps&fmt&sec` | Scene animation (apng / mp4 / webm) |
| GET | `/wallpaper-engine/scene-anim-progress/<token>` | Render progress polling |
| GET | `/wallpaper-engine/scene-runtime/<token>` | Scene iframe runtime |
| GET | `/wallpaper-engine/scene-manifest/<token>` | Scene package manifest |
| GET | `/wallpaper-engine/scene-resource/<token>` | Resource inside a scene package |
| GET | `/wallpaper-engine/scene-video/<token>` | Embedded MP4 audio/video track |
| GET | `/wallpaper-engine/scene-audio/<token>` | Standalone scene audio |
| GET | `/wallpaper-engine/custom-frame/<token>` | Screenshot-imported custom frame |
| POST | `/wallpaper-engine/upload?title=X` | Upload (raw body + content-type) |
| POST | `/wallpaper-engine/remove` | Remove upload (body `{"id"}` — **by id, not token**) |
| POST | `/wallpaper-engine/upload-dir` | Change the upload directory |

Every media path resolves through the base64url token map — **no arbitrary filesystem string ever reaches the URL space**.

## Install

### Prerequisites

- Wallpaper Engine installed via Steam, or point `ZCODE_WE_STEAM_ROOT` at your Steam root
- A ZCode source checkout (`git clone github.com/zai-org/ZCode`)
- Node ≥ 18, pnpm

### Steps

```sh
# in this repo
pnpm install
pnpm build        # produces lib/client.js (React + inlined CSS, single file)

# wire it into the ZCode checkout
pnpm start -- install --zcode-root <path-to-ZCode>
# or, from inside the ZCode checkout:
npx zcode-wallpaper-engine install
```

The installer does four things (details in [zcode.patch.yml](zcode.patch.yml)):

1. Junctions this package into `packages/wallpaper-engine` inside the pnpm workspace
2. Adds one `workspace:*` line to `packages/server/package.json`
3. Mounts `registerWallpaperEngineRoutes(app, { authToken })` in `packages/server/src/http.ts` — after `authToken` is in scope, before the static SPA catch-all
4. Inserts `<script defer src="/wallpaper-engine-client.js">` into `packages/web/index.html` and copies the bundle into `packages/web/public/`

Then `pnpm dev` in the ZCode checkout; the workbench gains **Settings → Wallpaper Engine**.

**Uninstall:** `zcode-wallpaper-engine uninstall` — removes the sentinel blocks verbatim and restores the checkout byte-for-byte (round-trip and idempotency are covered by tests).

### ZCode has no plugin bus, so these differ

| DSH | ZCode |
|---|---|
| `ctx.webServer.register({kind, path, handler})` | Hono `app.all(pattern, ...)`, see `lib/host.js: registerRoute` |
| Node handler writes `res` directly | `c.env.incoming/outgoing` — the raw `IncomingMessage`/`ServerResponse` that @hono/node-server exposes, so the handlers port **near-verbatim**; the route returns `x-hono-already-sent` to tell the adapter the response is already on the wire, otherwise it writes a second empty one and throws `ERR_HTTP_HEADERS_SENT` |
| `slots.inject` for the client | Build-time `<script>` insertion into `index.html` |
| `~/.dsh-wallpaper-engine/` | `~/.zcode-wallpaper-engine/` |
| `DSH_WE_*` env vars | `ZCODE_WE_STEAM_ROOT` / `ZCODE_WE_UPLOAD_DIR` / `ZCODE_WE_PORT` |
| `dsh-*` postMessage protocol | `zcode-*` |

## Auto-review (`pnpm verify`)

This is the self-check script (`scripts/auto-review.mjs`) and the answer to the "自动 review" requirement. A port this size (20 routes, a scene renderer, a React client) **drifts silently**: a route lost in the copy, a client module that stops building, a sentinel the installer can no longer find after an upstream refactor, a shim that reports 200 for a 404. Each is invisible until a user hits it. The script asserts the invariants that would break and exits non-zero with a report:

1. **shipped files** — every `package.json` `files` entry exists
2. **route table** — exactly 19 `registerRoute` sites (media/preview share one `for` loop body, so the anchor accepts any indentation); each declares kind + path; media routes must resolve through `mediaMap.get`
3. **client bundle** — self-contained: CSS inlined as strings (`?inline` imports + a runtime `<style>` tag, because the injection point is a single `<script>` and ZCode's Vite build has no slot for a companion asset), no external references, and the `?we-disable=1` escape hatch present
4. **dsh residue** — no `DSH_WE_*` env vars, no `.dsh-wallpaper-engine` dir, no `dsh-*` postMessage types
5. **installer sentinels** — begin/end pairs balance in all three block definitions; line-ending style is preserved (or the patch becomes an unreadable whole-file diff); the mount lands before the static catch-all
6. **bridge contracts** — `x-hono-already-sent` appears only in the node-server branch (in the shim branch it would mask every status code); `res.statusCode` is a live property (handlers assign `= 404` directly; a plain field makes every error report 200); the shim resolves on the response stream's end/error rather than on handler return (async handlers write the response after returning); the `Readable.fromWeb` destroy (normal end of input) vs handler abort (499) distinction is documented
7. **live routes** — boots the app against an isolated temp uploads dir and actually runs it: 4 static route checks + PUT/GET round trip + malformed-input 4xx + upload→remove round trip

`pnpm verify:mount` (`scripts/verify-mount.mjs`) goes one further: it esbuild-bundles the **real** `packages/server/src/http.ts`, boots `createHttpServer`, and proves the three routes answer 200 with no headers-sent errors.

```sh
pnpm verify         # auto review
pnpm verify:mount   # against the real patched ZCode server
pnpm test           # vitest: 17 tests (config / vdf / routes)
```

## Data and privacy

Wallpapers are **read locally only**: the Steam library, the WE workshop directory, and `~/.zcode-wallpaper-engine/uploads`. Nothing is uploaded or redistributed; the only outbound network request is the on-demand ffmpeg download, which happens only when transcode fps-capping is enabled. Settings and the upload library live in `~/.zcode-wallpaper-engine/`.

## License

MIT. The scene renderer's reverse-engineering builds on [linux-wallpaperengine](https://github.com/Alia5/linux-wallpaperengine) and [repkg](https://github.com/notscuffed/repkg).
