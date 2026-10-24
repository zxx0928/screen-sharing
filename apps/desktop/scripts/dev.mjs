import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureNativeAddon } from "./build-native.mjs";
import { copyStatic, startWatch } from "./bundle.mjs";

ensureNativeAddon();

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(appRoot, "package.json"));
const electronBinary = require("electron");

if (typeof electronBinary !== "string") {
  console.error("Could not resolve the Electron binary. Run npm install from the repo root.");
  process.exit(1);
}

let child = null;
let stopping = false;
let debounce = null;

function startElectron() {
  stopElectron();
  stopping = false;
  child = spawn(electronBinary, ["."], {
    cwd: appRoot,
    stdio: "inherit",
    env: { ...process.env, SCREEN_SHARING_DEV: "1" },
    detached: true,
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    process.exit(code ?? (signal ? 1 : 0));
  });
}

function stopElectron() {
  if (!child?.pid) return;
  stopping = true;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  child = null;
}

function scheduleRestart() {
  clearTimeout(debounce);
  debounce = setTimeout(startElectron, 200);
}

const dispose = await startWatch(scheduleRestart);

fs.watch(path.join(appRoot, "src/renderer"), (_event, filename) => {
  if (filename !== "index.html" && filename !== "styles.css") return;
  copyStatic();
  scheduleRestart();
});

function shutdown() {
  stopElectron();
  void dispose().finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
