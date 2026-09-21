/**
 * Boot the *actual patched* ZCode HTTP server and prove the mounted
 * /wallpaper-engine routes answer alongside ZCode's own /api routes.
 *
 * ZCode's server is TypeScript and resolves its workspace siblings through
 * pnpm, which is not available in this environment. esbuild bundles
 * packages/server/src/http.ts with everything except Node builtins inlined, so
 * the mount site we patched is the code that actually runs here.
 */
import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { installIntoZCode, uninstallFromZCode } from "./install-to-zcode.mjs";

const ZC = process.env.ZCODE_ROOT ?? "C:/Users/12774/AppData/Local/Temp/zcode";
const ROUTES = [
  "/api/server-info",
  "/wallpaper-engine/inventory",
  "/wallpaper-engine/settings",
];

async function bundleServer(root) {
  // Emit inside the server package's own node_modules so bare imports the
  // bundle leaves external ("ssh2", "undici", …) still resolve — the bundle
  // resolves from its own location upward, not from the original source file.
  const outDir = join(root, "packages", "server", "node_modules", ".we-verify");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "http.mjs");
  const absWorkingDir = join(root, "packages", "server");
  await build({
    absWorkingDir,
    entryPoints: [join(absWorkingDir, "src", "http.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: outFile,
    logLevel: "error",
    // Everything bundles except Node builtins. @zcode/* resolve as real
    // workspace packages (their exports maps point at src/**.ts); ssh2 and
    // cpu-features ship prebuilt .node binaries esbuild cannot inline.
    external: ["ssh2", "cpu-features", "ws", "@hono/node-ws", "@hono/node-server"],
  });
  return { outFile, outDir };
}

async function probe(server) {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const results = {};
  for (const path of ROUTES) {
    try {
      const res = await fetch(base + path);
      const body = await res.text();
      results[path] = { status: res.status, body: body.slice(0, 200) };
    } catch (err) {
      results[path] = { error: err.message };
    }
  }
  return results;
}

function report(results) {
  const failures = [];
  for (const path of ROUTES) {
    const r = results[path];
    const ok = r.status === 200;
    if (!ok) failures.push(path);
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${path} -> ${r.status ?? r.error}`);
    if (r.body) console.log(`        ${r.body.replace(/\s+/g, " ")}`);
  }
  return failures;
}

async function main() {
  console.log("installing into ZCode checkout …");
  const installed = await installIntoZCode({ zcodeRoot: ZC });
  if (!installed.ok) throw new Error(installed.message);

  let outDir;
  try {
    console.log("bundling patched packages/server/src/http.ts …");
    const { outFile, outDir: od } = await bundleServer(ZC);
    outDir = od;

    console.log("booting server …");
    const mod = await import(pathToFileURL(outFile).href);
    const server = mod.createHttpServer({}, 0, {});
    try {
      const results = await probe(server);
      const failures = report(results);
      if (failures.length) {
        throw new Error(`routes failed: ${failures.join(", ")}`);
      }
      console.log("\nMOUNT VERIFIED: /wallpaper-engine is live on the real ZCode server.");
    } finally {
      server.close();
    }
  } finally {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
    console.log("uninstalling (restoring the checkout byte-for-byte) …");
    await uninstallFromZCode({ zcodeRoot: ZC });
  }
}

main().catch((err) => {
  console.error("VERIFY FAILED:", err.message);
  process.exit(1);
});
