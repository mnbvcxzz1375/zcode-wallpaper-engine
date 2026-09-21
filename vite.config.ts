import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const HERE = fileURLToPath(new URL(".", import.meta.url));

// The client half ships as a single self-running script injected into the
// ZCode page. React is bundled (ZCode does not expose its own React copy as a
// global), and everything mounts into private DOM nodes under <body>.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(HERE, "src/client/index.tsx"),
      formats: ["iife"],
      name: "ZCodeWallpaperEngine",
      fileName: () => "client.js",
    },
    outDir: resolve(HERE, "lib"),
    emptyOutDir: false,
    sourcemap: false,
    minify: "esbuild",
    target: "es2020",
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});
