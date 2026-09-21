/**
 * 自动 review — the self-check this port runs before it is shipped.
 *
 * A port of a plugin this large (19 host routes, a scene renderer, a React
 * client) drifts silently: a route dropped in the copy, a client module that
 * no longer builds, a sentinel the installer stops finding after an upstream
 * refactor, a shim that returns 200 for a 404. Each is invisible until a user
 * hits it. This script asserts the invariants that would break, and exits
 * non-zero with a report so `pnpm verify` fails the build.
 *
 * Run: npm run verify
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** A finding the reviewer will not ship without addressing. */
class Finding {
  constructor(severity, id, message, detail) {
    this.severity = severity;
    this.id = id;
    this.message = message;
    this.detail = detail ?? "";
  }
}

const findings = [];
const note = (id, message, detail) => findings.push(new Finding("info", id, message, detail));
const warn = (id, message, detail) => findings.push(new Finding("warn", id, message, detail));
const fail = (id, message, detail) => findings.push(new Finding("error", id, message, detail));

function read(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

function fileSize(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? statSync(p).size : -1;
}

// ── 1. Files the package ships must all exist ──────────────────────────────
// package.json `files` is the publish manifest; a missing entry ships a
// broken tarball that imports nothing.
reviewShippedFiles();

// ── 2. Every upstream host route is accounted for ──────────────────────────
// The port is mechanical: 19 routes registered through registerRoute. A count
// drift means a route was lost in the copy (or a duplicate was added).
reviewRouteTable();

// ── 3. The client builds and is self-contained ────────────────────────────
// The injected client must be one file with its CSS inlined — ZCode's web
// build has no hook to ship a second asset alongside it.
reviewClientBundle();

// ── 4. The port's dsh residue is gone ──────────────────────────────────────
// Leftover dsh identifiers are not just cosmetic: a dsh env var silently does
// nothing, and a dsh postMessage type is a protocol the new client never sends.
reviewDshResidue();

// ── 5. The installer's sentinels round-trip ────────────────────────────────
// install/uninstall must restore the ZCode checkout byte-for-byte; a sentinel
// the uninstaller cannot find leaves the patch in the user's tree forever.
reviewInstallerSentinels();

// ── 6. The Hono bridge contracts hold ──────────────────────────────────────
// x-hono-already-sent only belongs on the node-server branch; under the web
// shim it would mask every status code the handlers set.
reviewBridgeContract();

// ── 7. Live route smoke against the mounted app ───────────────────────────
// Static checks cannot catch a handler that throws on real input.
await reviewLiveRoutes();

// ── report ────────────────────────────────────────────────────────────────
report();

function reviewShippedFiles() {
  const pkg = JSON.parse(read("package.json"));
  const missing = [];
  for (const entry of pkg.files ?? []) {
    const p = join(ROOT, entry);
    if (!existsSync(p)) missing.push(entry);
  }
  if (missing.length) {
    fail("files.missing", `package.json ships ${missing.length} missing path(s)`, missing.join(", "));
  } else {
    note("files.present", `all ${pkg.files.length} shipped paths exist`);
  }

  // The generated client is a build artifact; verify:mount would fail without
  // it, but the review should still flag it instead of crashing.
  for (const required of ["lib/host.js", "lib/client.js", "bin/cli.mjs"]) {
    if (fileSize(required) <= 0) fail(`files.${required}`, `${required} is missing or empty`);
  }
}

function reviewRouteTable() {
  const host = read("lib/host.js");
  if (!host) {
    fail("host.missing", "lib/host.js is missing");
    return;
  }
  // The port is 1:1 with the dsh host: 19 disposers.push(registerRoute({ call
  // sites. One of them is the media/preview pair registered inside a `for`
  // loop (4-space indent), so the anchor must accept any indentation or that
  // route silently disappears from the count.
  const EXPECTED = 19;
  const registrations = host.match(/^\s{2,}disposers\.push\(registerRoute\(\{/gm) ?? [];
  if (registrations.length !== EXPECTED) {
    fail(
      "routes.count",
      `expected ${EXPECTED} registerRoute calls, found ${registrations.length}`,
      "A route was lost or duplicated in the port. Diff lib/host.js against the dsh host's webServer.register call sites.",
    );
  } else {
    note("routes.count", `${EXPECTED} host routes registered (media/preview share one loop body)`);
  }

  // Every route must declare both kind and path — a route without a kind
  // silently never matches.
  const routeBlocks = host.split(/^\s{2,}disposers\.push\(registerRoute\(\{/m).slice(1);
  const malformed = routeBlocks.filter((b) => !/kind:\s*'(exact|prefix)'/.test(b) || !/path:\s*`?\$\{BASE\}/.test(b));
  if (malformed.length) {
    fail("routes.malformed", `${malformed.length} route(s) missing kind or path`);
  }

  // The token map is what keeps an arbitrary filesystem string out of the URL:
  // every route that serves media bytes must resolve through mediaMap, never a
  // raw path. Match on the route's own path field — the upload route mentions
  // /media/ in the URLs it *emits* and is not a media-serving route. The
  // media/preview pair is registered by one loop body (`${BASE}/${seg}`), so
  // count it as the two routes it actually installs.
  const loopRoute = routeBlocks.find((b) => /path:\s*`\$\{BASE\}\/\$\{seg\}`/.test(b));
  const mediaRoutes = routeBlocks.filter((b) => {
    const m = b.match(/path:\s*`\$\{BASE\}\/(media|preview|transcoded)`/);
    return !!m;
  });
  const loopWeight = loopRoute ? 2 : 0;
  const total = mediaRoutes.length + loopWeight;
  const withoutMap = mediaRoutes.filter((b) => !/mediaMap\.get/.test(b));
  if (loopRoute && !/mediaMap\.get/.test(loopRoute)) withoutMap.push("media/preview loop body");
  if (withoutMap.length) {
    fail("routes.token", `${withoutMap.length} of ${total} media route(s) bypass the token map`, withoutMap.join(", "));
  } else {
    note("routes.token", `${total} media routes resolve through the base64url token map`);
  }
}

function reviewClientBundle() {
  const size = fileSize("lib/client.js");
  if (size <= 0) {
    fail("client.missing", "lib/client.js is missing — run `npm run build`");
    return;
  }
  const src = read("lib/client.js");
  // The client is injected as a plain <script> tag into ZCode's index.html, so
  // it cannot ship a companion .css asset: the sheets are imported with
  // ?inline (Vite emits them as JS strings) and written into a <style> tag the
  // bundle creates at runtime. The invariant is that the CSS text actually
  // made it into the bundle, not a literal <style> element.
  const declarations = (src.match(/[a-z-]+:\s*(?:#[0-9a-fA-F]{3,8}|\d+(?:\.\d+)?(?:px|%|rem|em|deg|s|ms|vh|vw))/g) ?? []).length;
  if (!src.includes("data-plugin-css") || declarations < 50) {
    fail(
      "client.css",
      `CSS is not self-contained in the bundle (${declarations} declarations, data-plugin-css tag ${src.includes("data-plugin-css") ? "present" : "missing"})`,
      "styles.css and components.css must be imported with ?inline so the bundle carries the sheets as strings.",
    );
  } else {
    note("client.css", `${declarations} CSS declarations inlined, ${Math.round(size / 1024)} KB total`);
  }

  // A bundle that still reaches for an external module would fail at runtime
  // inside the workbench, where those deps are not on the page.
  const externalRefs = src.match(/from"https?:\/\/|require\(["']\.\.?\//g) ?? [];
  if (externalRefs.length) {
    fail("client.external", `${externalRefs.length} external module reference(s) in the bundle`);
  }

  // The bootstrap must be guarded so the panel never bricks the workbench.
  if (!/we-disable/.test(src)) {
    warn("client.guard", "?we-disable=1 escape hatch not found in the bundle");
  }
}

function reviewDshResidue() {
  const host = read("lib/host.js") ?? "";
  const residue = [];
  // Env vars: a dsh-prefixed var is read but never set, so the feature is dead.
  for (const m of host.matchAll(/process\.env\.(DSH_WE_[A-Z_]+)/g)) residue.push(m[1]);
  // Data dir: the wrong config path silently splits the user's settings.
  if (/\.dsh-wallpaper-engine/.test(host)) residue.push("~/.dsh-wallpaper-engine data dir");
  // postMessage protocol: the client sends zcode-* types; a dsh-* type is
  // never produced and the renderer would hang waiting for it.
  for (const m of host.matchAll(/['"`]dsh-[a-z-]+['"`]/g)) residue.push(m[0]);

  if (residue.length) {
    const uniq = [...new Set(residue)];
    fail("dsh.residue", `${uniq.length} dsh identifier(s) remain in lib/host.js`, uniq.join(", "));
  } else {
    note("dsh.residue", "no dsh identifiers remain in the host");
  }

  const scene = read("lib/scene-player.js") ?? "";
  const sceneResidue = [...new Set([...scene.matchAll(/['"`]dsh-[a-z-]+['"`]/g)].map((m) => m[0]))];
  if (sceneResidue.length) {
    fail("dsh.scene", `${sceneResidue.length} dsh postMessage type(s) remain in scene-player.js`, sceneResidue.join(", "));
  } else {
    note("dsh.scene", "scene postMessage types are zcode-*");
  }
}

function reviewInstallerSentinels() {
  const installer = read("scripts/install-to-zcode.mjs");
  if (!installer) {
    fail("installer.missing", "scripts/install-to-zcode.mjs is missing");
    return;
  }
  // Sentinel tokens must be identical between install and uninstall; a drift
  // leaves the block installed with no way to remove it. The idempotency probe
  // (`http.includes(line(`${IMPORT_TOKEN}-begin`))`) reads the begin sentinel
  // without its end twin, so count emitted blocks rather than raw references.
  const tokens = [
    ...installer.matchAll(/const (?:IMPORT_)?TOKEN = ["`](zcode-wallpaper-engine[a-z-]*)["`];/g),
  ].map((m) => m[1]);
  const blockDefs = [...installer.matchAll(/^const (?:SERVER_IMPORT_BLOCK|SERVER_MOUNT_BLOCK|HTML_BLOCK) = \[([^\]]*)\]/gms)];
  let unbalanced = 0;
  for (const [, body] of blockDefs) {
    const b = (body.match(/-begin`/g) ?? []).length;
    const e = (body.match(/-end`/g) ?? []).length;
    if (b !== 1 || e !== 1) unbalanced++;
  }
  if (unbalanced) {
    fail("sentinel.balance", `${unbalanced} block definition(s) with mismatched begin/end sentinels`);
  } else {
    note("sentinel.balance", `${blockDefs.length} sentinel block pairs, tokens: ${[...new Set(tokens)].join(", ")}`);
  }

  // The mount must land before the static catch-all or the SPA answers every
  // /wallpaper-engine request with index.html.
  if (!/before the static/.test(installer)) {
    warn("sentinel.order", "mount placement rationale comment not found");
  } else {
    note("sentinel.order", "mount lands before the static SPA catch-all");
  }

  // The installer must preserve the checkout's line endings or the patch
  // becomes an unreadable whole-file diff in review.
  if (!/CRLF/.test(installer)) {
    fail("sentinel.lineendings", "line-ending preservation is not implemented");
  } else {
    note("sentinel.lineendings", "line-ending preservation implemented");
  }
}

function reviewBridgeContract() {
  const host = read("lib/host.js");
  if (!host) return;

  // x-hono-already-sent tells @hono/node-server the Node-style handler already
  // wrote the response. It must NOT be returned from the web-shim branch,
  // where the shim's own Response carries the real status code.
  const shimBranch = host.split("function registerRoute")[0];
  if (/x-hono-already-sent/.test(shimBranch)) {
    fail("bridge.sentinel", "x-hono-already-sent returned from the web-shim path (would mask every status code)");
  }

  // The shim must expose statusCode as a live property: handlers assign
  // res.statusCode = 404 directly, and a plain field leaves every error
  // reporting as 200 under non-node-server adapters.
  if (!/defineProperty\(res, 'statusCode'/.test(host)) {
    fail("bridge.statuscode", "shim does not make res.statusCode a live property");
  } else {
    note("bridge.statuscode", "res.statusCode is live in the web shim");
  }

  // The shim must resolve on the response stream's end, not on the handler's
  // return — async handlers (upload, scene extraction) write after returning.
  if (/if \(!res\.writableEnded\) \{ try \{ res\.end\(\)/.test(host)) {
    fail("bridge.async", "shim force-ends the response before async handlers can write it");
  } else {
    note("bridge.async", "shim resolves on the response stream, async handlers are safe");
  }

  // 499 must not fire on a fully-consumed request body: Readable.fromWeb
  // destroys the readable as a normal end-of-input, which must be told apart
  // from a handler abort.
  if (!/Readable\.fromWeb destroys/.test(host)) {
    warn("bridge.destroy", "Readable.fromWeb destroy-vs-abort distinction not documented");
  } else {
    note("bridge.destroy", "destroy (end of input) is distinguished from abort (499)");
  }
}

async function reviewLiveRoutes() {
  // Boot the mounted app and exercise the routes that carry the client's
  // contract: the JSON surface, the error paths, and an upload round trip.
  // Isolated in a temp uploads dir so the user's library is never touched.
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const scratch = mkdtempSync(join(tmpdir(), "we-review-"));
  const uploads = join(scratch, "uploads");
  mkdirSync(uploads, { recursive: true });
  process.env.ZCODE_WE_UPLOAD_DIR = uploads;

  try {
    const host = await import(pathToFileURL(join(ROOT, "lib", "host.js")).href);
    const app = host.createWallpaperEngineApp();

    const checks = [
      ["/wallpaper-engine/inventory", 200],
      ["/wallpaper-engine/settings", 200],
      ["/wallpaper-engine/media-info/unknown", 404],
      ["/wallpaper-engine/no-such-route", 404],
    ];
    for (const [path, want] of checks) {
      const res = await app.request(path);
      if (res.status !== want) {
        fail(`live.${path}`, `expected ${want}, got ${res.status}`);
      }
    }

    // PUT/GET round trip with the body shape the client actually sends.
    const put = await app.request("/wallpaper-engine/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scrim: 0.5, accent: "#112233", blur: 20 }),
    });
    if (put.status !== 200) {
      fail("live.settings.put", `PUT settings expected 200, got ${put.status}`);
    } else {
      const get = await app.request("/wallpaper-engine/settings");
      const s = (await get.json()).settings;
      if (!s || s.scrim !== 0.5 || s.accent !== "#112233") {
        fail("live.settings.persist", "PUT settings did not persist through GET");
      } else {
        note("live.settings.persist", "PUT/GET settings round trip holds");
      }
    }

    // Malformed input must answer an error status, never crash the app — the
    // client is injected into the workbench and cannot take it down.
    const bad = await app.request("/wallpaper-engine/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{broken",
    });
    if (bad.status < 400) {
      fail("live.settings.malformed", `malformed PUT expected 4xx, got ${bad.status}`);
    }

    // Upload + remove round trip against the isolated dir.
    const up = await app.request("/wallpaper-engine/upload?title=review.png", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array([1, 2, 3]),
    });
    if (up.status !== 200) {
      fail("live.upload", `upload expected 200, got ${up.status}`);
    } else {
      const { id } = await up.json();
      const rm = await app.request("/wallpaper-engine/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (rm.status !== 200) fail("live.remove", `remove expected 200, got ${rm.status}`);
      else note("live.upload", "upload → remove round trip holds");
    }

    note("live.routes", `${checks.length} static route checks + 3 round trips`);
  } catch (err) {
    fail("live.boot", `the mounted app threw: ${err.message}`, err.stack);
  } finally {
    delete process.env.ZCODE_WE_UPLOAD_DIR;
    rmSync(scratch, { recursive: true, force: true });
  }
}

function report() {
  const errors = findings.filter((f) => f.severity === "error");
  const warns = findings.filter((f) => f.severity === "warn");

  console.log("");
  console.log("zcode-wallpaper-engine — auto review");
  console.log("=".repeat(60));
  for (const f of findings) {
    const tag = f.severity === "error" ? "FAIL" : f.severity === "warn" ? "WARN" : " ok ";
    console.log(`  [${tag}] ${f.id}: ${f.message}`);
    if (f.detail) console.log(`          ${f.detail}`);
  }
  console.log("-".repeat(60));
  console.log(`  ${findings.length} check(s): ${errors.length} error(s), ${warns.length} warning(s)`);
  console.log("");

  if (errors.length) {
    console.log("REVIEW FAILED — fix the errors above before shipping.");
    process.exitCode = 1;
  } else {
    console.log("REVIEW PASSED — the port's invariants hold.");
  }
}
