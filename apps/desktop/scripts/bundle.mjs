import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(appRoot, "dist");

// Keep electron external. The Win32 addon is a .node file; esbuild must not
// parse it. The main process loads it with an absolute path at runtime.
const external = ["electron", "screen_sharing_win32"];

const nativeExternal = {
  name: "native-node",
  setup(build) {
    build.onResolve({ filter: /\.node$/ }, (args) => ({
      path: args.path,
      external: true,
    }));
  },
};

const mainOptions = {
  entryPoints: {
    main: path.join(appRoot, "src/main/index.ts"),
    preload: path.join(appRoot, "src/preload/index.ts"),
  },
  outdir: distDir,
  bundle: true,
  platform: "node",
  format: "cjs",
  external,
  plugins: [nativeExternal],
  sourcemap: true,
  target: "node20",
  logLevel: "info",
};

const rendererOptions = {
  entryPoints: [path.join(appRoot, "src/renderer/renderer.ts")],
  outfile: path.join(distDir, "renderer/renderer.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  sourcemap: true,
  target: ["chrome128"],
  logLevel: "info",
};

export function copyStatic() {
  const rendererDist = path.join(distDir, "renderer");
  fs.mkdirSync(rendererDist, { recursive: true });
  for (const file of ["index.html", "styles.css"]) {
    fs.copyFileSync(path.join(appRoot, "src/renderer", file), path.join(rendererDist, file));
  }
  const addon = path.join(appRoot, "native", "win32", "build", "Release", "screen_sharing_win32.node");
  if (fs.existsSync(addon)) {
    fs.copyFileSync(addon, path.join(distDir, "screen_sharing_win32.node"));
  }
}

export async function buildOnce() {
  copyStatic();
  await esbuild.build(mainOptions);
  await esbuild.build(rendererOptions);
}

export async function startWatch(onRebuild) {
  copyStatic();
  let mainReady = false;
  let rendererReady = false;
  const plugin = (which) => ({
    name: `rebuild-${which}`,
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) return;
        if (which === "main") mainReady = true;
        if (which === "renderer") rendererReady = true;
        if (mainReady && rendererReady) onRebuild();
      });
    },
  });

  const mainCtx = await esbuild.context({ ...mainOptions, plugins: [...(mainOptions.plugins ?? []), plugin("main")] });
  const rendererCtx = await esbuild.context({ ...rendererOptions, plugins: [plugin("renderer")] });
  await Promise.all([mainCtx.watch(), rendererCtx.watch()]);
  return async () => {
    await mainCtx.dispose();
    await rendererCtx.dispose();
  };
}
