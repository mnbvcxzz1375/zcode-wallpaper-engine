/**
 * Wire zcode-wallpaper-engine into a ZCode checkout.
 *
 * ZCode has no out-of-tree plugin bus for the workbench UI (its native plugin
 * system only extends the agent: commands / skills / hooks / MCPs). The port
 * therefore integrates at two compile-time points, both reversible and
 * idempotent — the same shape as the upstream port's cordis.patch.yml:
 *
 *   1. Server  packages/server/src/http.ts
 *      Mount registerWallpaperEngineRoutes(app) under /wallpaper-engine, BEFORE
 *      the static SPA catch-all (otherwise index.html answers every route).
 *   2. Web     packages/web/index.html + packages/web/public/
 *      Inject the built client as a deferred script; Vite serves public/ at
 *      the site root in dev and copies it into the production build.
 *
 *   3. Workspace  packages/wallpaper-engine -> <this package>
 *      A symlink so pnpm's existing `packages/*` glob picks the package up
 *      without editing pnpm-workspace.yaml, plus a workspace:* dependency on
 *      @zcode/server so the import resolves.
 *
 * Every patch is wrapped in sentinel comments (token-identical across file
 * types; only the comment syntax differs) so re-running replaces the block and
 * uninstall restores the file byte-for-byte.
 *
 * All sentinel math runs on LF-normalized text; the file's own line ending is
 * restored on write. ZCode's checkout is CRLF on Windows, and splicing CRLF
 * text directly leaves stray carriage returns that turn the patch into a
 * whole-file diff.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");

/** Sentinel tokens — identical in every file type; comment syntax is added. */
const TOKEN = "zcode-wallpaper-engine";
const IMPORT_TOKEN = `${TOKEN}-import`;
const MOUNT_TOKEN = `${TOKEN}-mount`;

const CLIENT_PUBLIC_NAME = "wallpaper-engine-client.js";

// comment wrappers per file type
const line = (t) => `// ${t}`;
const html = (t) => `<!-- ${t} -->`;

const SERVER_IMPORT_BLOCK = [
  line(`${IMPORT_TOKEN}-begin`),
  `import { registerWallpaperEngineRoutes } from "@zcode/wallpaper-engine";`,
  line(`${IMPORT_TOKEN}-end`),
].join("\n");

const SERVER_MOUNT_BLOCK = [
  `  ${line(`${MOUNT_TOKEN}-begin`)}`,
  "  // Mount the wallpaper-engine routes on the main app (full paths, so Range",
  "  // streaming and the auth gate behave exactly as ZCode's own /api routes).",
  "  // Registered here — after authToken is in scope, before the static SPA",
  "  // catch-all, which would otherwise answer every /wallpaper-engine request.",
  "  registerWallpaperEngineRoutes(app, {",
  "    // Inherit ZCode's auth gate when the server binds a non-loopback host.",
  "    authToken: authToken,",
  "  });",
  `  ${line(`${MOUNT_TOKEN}-end`)}`,
].join("\n");

const HTML_BLOCK = [
  `    ${html(`${MOUNT_TOKEN}-begin`)}`,
  `    <script defer src="/${CLIENT_PUBLIC_NAME}"></script>`,
  `    ${html(`${MOUNT_TOKEN}-end`)}`,
].join("\n");

/** Read a file as LF for sentinel math. */
function readPatch(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

/**
 * Write `next` in the original file's line-ending style. ZCode's checkout is
 * CRLF on Windows; emitting LF makes every line a diff and would make the
 * patch unreadable in review.
 */
function writePatch(path, next) {
  const crlf = readFileSync(path, "utf8").includes("\r\n");
  writeFileSync(path, crlf ? next.replace(/\n/g, "\r\n") : next);
}

/**
 * Replace a sentinel-wrapped block. `open`/`close` are the exact comment lines
 * (including syntax). Absent → insert `block` before `anchor` (or at EOF).
 */
function replaceBlock(text, open, close, block, anchor) {
  const start = text.indexOf(open);
  if (start === -1) {
    if (anchor) {
      const i = text.indexOf(anchor);
      if (i === -1) throw new Error(`anchor not found: ${anchor.slice(0, 40)}…`);
      return text.slice(0, i) + block + "\n" + text.slice(i);
    }
    return text + "\n" + block;
  }
  const stop = text.indexOf(close, start);
  if (stop === -1) throw new Error(`unbalanced sentinel: ${open}`);
  // stop + close.length lands on the trailing newline's position; keep the
  // newline so the join stays intact.
  return text.slice(0, start) + block + text.slice(stop + close.length);
}

/** Remove a sentinel block plus the (now empty) line it occupied. */
function removeBlock(text, open, close) {
  const start = text.indexOf(open);
  if (start === -1) return text;
  const stop = text.indexOf(close, start);
  if (stop === -1) return text;
  // Extend to the end of the close comment's line.
  let end = stop + close.length;
  while (end < text.length && text[end] === "\n") end++;
  // Start the removal at the beginning of the sentinel's own line: the block
  // is indented to match the surrounding code, and leaving that indent behind
  // welds it onto whatever line follows the block.
  let begin = start;
  while (begin > 0 && (text[begin - 1] === " " || text[begin - 1] === "\t")) begin--;
  return text.slice(0, begin) + text.slice(end);
}

/** Insert an import after the last top-level `import … from "…"` line. */
function insertImport(text, block) {
  const lines = text.split("\n");
  let lastImport = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^import\s[\s\S]*?from\s+["']/.test(l)) {
      lastImport = i;
      continue;
    }
    // The import section ends at the first line of real code.
    if (l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("/*") && !l.trim().startsWith("*")) {
      break;
    }
  }
  if (lastImport === -1) throw new Error("could not locate the import section");
  lines.splice(lastImport + 1, 0, block);
  return lines.join("\n");
}

/**
 * Locate the ZCode checkout: explicit flag, a sibling directory of this
 * package's parent, or the CWD.
 */
function resolveZCodeRoot(explicit) {
  if (explicit) {
    const r = resolve(explicit);
    if (!isZCodeRoot(r)) throw new Error(`not a ZCode checkout: ${r}`);
    return r;
  }
  const candidates = [
    process.cwd(),
    resolve(PKG_ROOT, "..", "ZCode"),
    resolve(PKG_ROOT, "..", "zcode"),
    resolve(PKG_ROOT, "..", "..", "ZCode"),
  ];
  for (const c of candidates) {
    if (isZCodeRoot(c)) return c;
  }
  throw new Error(
    "ZCode checkout not found. Pass --zcode-root <path> (a clone of github.com/zai-org/ZCode).",
  );
}

function isZCodeRoot(dir) {
  return (
    existsSync(join(dir, "pnpm-workspace.yaml")) &&
    existsSync(join(dir, "packages", "server", "src", "http.ts")) &&
    existsSync(join(dir, "packages", "web", "index.html"))
  );
}

export async function installIntoZCode({ zcodeRoot } = {}) {
  const root = resolveZCodeRoot(zcodeRoot);

  // 1. Workspace symlink so `@zcode/wallpaper-engine` resolves.
  const linkDir = join(root, "packages", "wallpaper-engine");
  let linked = false;
  if (!existsSync(linkDir)) {
    try {
      symlinkSync(PKG_ROOT, linkDir, "junction");
      linked = true;
    } catch (err) {
      return { ok: false, message: `failed to link ${linkDir}: ${err.message}` };
    }
  } else if (realpathSync(linkDir) !== PKG_ROOT) {
    return { ok: false, message: `${linkDir} exists and is not this package; refusing to overwrite` };
  }

  // 2a. Workspace dependency on @zcode/server so the import resolves.
  const serverPkgPath = join(root, "packages", "server", "package.json");
  const serverPkgRaw = readFileSync(serverPkgPath, "utf8");
  const serverPkg = JSON.parse(serverPkgRaw);
  serverPkg.dependencies = serverPkg.dependencies || {};
  if (serverPkg.dependencies["@zcode/wallpaper-engine"] !== "workspace:*") {
    serverPkg.dependencies["@zcode/wallpaper-engine"] = "workspace:*";
    // Keep the dependency map alphabetized so the diff is one added line.
    const sorted = Object.keys(serverPkg.dependencies).sort();
    const reordered = {};
    for (const k of sorted) reordered[k] = serverPkg.dependencies[k];
    serverPkg.dependencies = reordered;
    writePatch(serverPkgPath, JSON.stringify(serverPkg, null, 2) + "\n");
  }

  // 2b. Server middleware. Two patches: the import must land in the module's
  // import section (an import inside a function is a syntax error), the mount
  // call goes where the routes are registered — before the static catch-all.
  const httpPath = join(root, "packages", "server", "src", "http.ts");
  let http = readPatch(httpPath);
  try {
    if (http.includes(line(`${IMPORT_TOKEN}-begin`))) {
      http = replaceBlock(
        http,
        line(`${IMPORT_TOKEN}-begin`),
        line(`${IMPORT_TOKEN}-end`),
        SERVER_IMPORT_BLOCK,
        null,
      );
    } else {
      http = insertImport(http, SERVER_IMPORT_BLOCK);
    }
    http = replaceBlock(
      http,
      line(`${MOUNT_TOKEN}-begin`),
      line(`${MOUNT_TOKEN}-end`),
      SERVER_MOUNT_BLOCK,
      '  app.post("/api/rpc-host-capability",',
    );
  } catch (err) {
    return { ok: false, message: `server patch failed: ${err.message}` };
  }
  writePatch(httpPath, http);

  // 3. Web client: copy into public/ + script tag in index.html.
  const clientSrc = join(PKG_ROOT, "lib", "client.js");
  if (!existsSync(clientSrc)) {
    return {
      ok: false,
      message: `lib/client.js is missing — run \`pnpm build\` in ${PKG_ROOT} first.`,
    };
  }
  const publicDir = join(root, "packages", "web", "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, CLIENT_PUBLIC_NAME), readFileSync(clientSrc));

  const htmlPath = join(root, "packages", "web", "index.html");
  let indexHtml = readPatch(htmlPath);
  try {
    indexHtml = replaceBlock(
      indexHtml,
      html(`${MOUNT_TOKEN}-begin`),
      html(`${MOUNT_TOKEN}-end`),
      HTML_BLOCK,
      "  </body>",
    );
  } catch (err) {
    return { ok: false, message: `web patch failed: ${err.message}` };
  }
  writePatch(htmlPath, indexHtml);

  return {
    ok: true,
    message: [
      "zcode-wallpaper-engine installed into " + root,
      `  ${linked ? "linked" : "already linked"} packages/wallpaper-engine -> ${PKG_ROOT}`,
      "  mounted /wallpaper-engine routes on @zcode/server",
      `  injected client script into packages/web (${CLIENT_PUBLIC_NAME})`,
      "",
      "Next: run `pnpm install` in the ZCode root (picks up the new workspace",
      "package), then `pnpm dev:web` or `pnpm dev:desktop`. The wallpaper panel",
      "opens from the floating button at the right edge of the workbench.",
    ].join("\n"),
  };
}

export async function uninstallFromZCode({ zcodeRoot } = {}) {
  const root = resolveZCodeRoot(zcodeRoot);

  const httpPath = join(root, "packages", "server", "src", "http.ts");
  if (existsSync(httpPath)) {
    let http = readPatch(httpPath);
    http = removeBlock(http, line(`${IMPORT_TOKEN}-begin`), line(`${IMPORT_TOKEN}-end`));
    http = removeBlock(http, line(`${MOUNT_TOKEN}-begin`), line(`${MOUNT_TOKEN}-end`));
    writePatch(httpPath, http);
  }

  const serverPkgPath = join(root, "packages", "server", "package.json");
  if (existsSync(serverPkgPath)) {
    const serverPkg = JSON.parse(readFileSync(serverPkgPath, "utf8"));
    if (serverPkg.dependencies && serverPkg.dependencies["@zcode/wallpaper-engine"]) {
      delete serverPkg.dependencies["@zcode/wallpaper-engine"];
      writePatch(serverPkgPath, JSON.stringify(serverPkg, null, 2) + "\n");
    }
  }

  const htmlPath = join(root, "packages", "web", "index.html");
  if (existsSync(htmlPath)) {
    let indexHtml = readPatch(htmlPath);
    indexHtml = removeBlock(indexHtml, html(`${MOUNT_TOKEN}-begin`), html(`${MOUNT_TOKEN}-end`));
    writePatch(htmlPath, indexHtml);
  }

  const clientPublic = join(root, "packages", "web", "public", CLIENT_PUBLIC_NAME);
  if (existsSync(clientPublic)) unlinkSync(clientPublic);

  const linkDir = join(root, "packages", "wallpaper-engine");
  // Windows junctions report isSymbolicLink() === false, so compare targets
  // instead of testing the link type.
  if (existsSync(linkDir) && realpathSync(linkDir) === PKG_ROOT) {
    rmSync(linkDir, { force: true });
  }

  return {
    ok: true,
    message: "zcode-wallpaper-engine wiring removed from " + root,
  };
}
