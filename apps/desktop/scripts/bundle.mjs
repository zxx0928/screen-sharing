import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(appRoot, "dist");

// Keep electron external. Future native addons (DXGI / SendInput) must be
// added here too — esbuild cannot bundle .node files.
const external = ["electron"];

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

  const mainCtx = await esbuild.context({ ...mainOptions, plugins: [plugin("main")] });
  const rendererCtx = await esbuild.context({ ...rendererOptions, plugins: [plugin("renderer")] });
  await Promise.all([mainCtx.watch(), rendererCtx.watch()]);
  return async () => {
    await mainCtx.dispose();
    await rendererCtx.dispose();
  };
}
