#!/usr/bin/env node
/**
 * zcode-wallpaper-engine CLI.
 *
 *   zcode-wallpaper-engine serve [--port 0] [--host 127.0.0.1]
 *     Run the wallpaper-engine HTTP surface standalone (dev / debugging).
 *     Open http://127.0.0.1:<port>/wallpaper-engine/inventory to verify.
 *
 *   zcode-wallpaper-engine install [--zcode-root <path>]
 *     Wire this package into a ZCode checkout (server middleware + web client).
 *
 *   zcode-wallpaper-engine uninstall [--zcode-root <path>]
 *     Revert the wiring above.
 *
 * In normal use the routes are mounted by ZCode itself (see
 * scripts/install-to-zcode.mjs) and this CLI is only needed for development.
 */
import { createStandaloneServer } from "../lib/host.js";
import { installIntoZCode, uninstallFromZCode } from "../scripts/install-to-zcode.mjs";

const [, , cmd, ...args] = process.argv;

function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  if (cmd === "serve") {
    const server = await createStandaloneServer({
      port: Number(flag("--port") || 0) || 0,
      host: flag("--host"),
    });
    const shutdown = () => { try { server.close(); } catch { /* ignore */ } process.exit(0); };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }
  if (cmd === "install" || cmd === "uninstall") {
    const zcodeRoot = flag("--zcode-root");
    const fn = cmd === "install" ? installIntoZCode : uninstallFromZCode;
    const result = await fn({ zcodeRoot });
    console.log(result.message);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  console.log(`zcode-wallpaper-engine

usage:
  zcode-wallpaper-engine serve [--port 0] [--host 127.0.0.1]
  zcode-wallpaper-engine install [--zcode-root <path>]
  zcode-wallpaper-engine uninstall [--zcode-root <path>]`);
}

void main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
