import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeRoot = path.join(appRoot, "native", "win32");

/**
 * Build the Win32 DXGI / SendInput addon against the installed Electron headers.
 * Linux and macOS skip this. The TypeScript host still typechecks and tests.
 */
export function ensureNativeAddon() {
  if (process.platform !== "win32") {
    console.log(`[native] skip screen_sharing_win32 (platform is ${process.platform})`);
    return;
  }

  const require = createRequire(path.join(appRoot, "package.json"));
  const electronVersion = require("electron/package.json").version;
  const gypEntry = require.resolve("node-gyp/bin/node-gyp.js");
  const arch = process.arch === "ia32" ? "ia32" : process.arch;
  console.log(`[native] building screen_sharing_win32 for Electron ${electronVersion} (${arch})`);
  const result = spawnSync(
    process.execPath,
    [gypEntry, "rebuild", `--target=${electronVersion}`, `--arch=${arch}`, "--dist-url=https://electronjs.org/headers"],
    { cwd: nativeRoot, stdio: "inherit" },
  );
  if (result.status !== 0) {
    console.error(
      "[native] build failed. Install Visual Studio 2022 Build Tools (Desktop development with C++), the Windows 10/11 SDK, and Python 3. Then run: npm run build:native -w @screen-sharing/desktop",
    );
    process.exit(result.status ?? 1);
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) ensureNativeAddon();
