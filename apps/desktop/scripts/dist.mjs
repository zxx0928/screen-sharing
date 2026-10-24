import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureNativeAddon } from "./build-native.mjs";
import { buildOnce } from "./bundle.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

ensureNativeAddon();
await buildOnce();

const require = createRequire(path.join(appRoot, "package.json"));
let builderCli;
try {
  builderCli = require.resolve("electron-builder/cli.js");
} catch {
  console.error("[dist] electron-builder is not installed. From the repo root, run: npm install");
  process.exit(1);
}

const result = spawnSync(process.execPath, [builderCli, "--publish", "never", ...process.argv.slice(2)], {
  cwd: appRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? "false",
  },
});

if (result.error) {
  console.error("[dist] failed to start electron-builder", result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
