import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { H264Probe } from "./h264-plan";
import type { Win32InputCommand } from "./input-mapping";

export const WIN32_ADDON_ABI = 1;
const ADDON_FILE = "screen_sharing_win32.node";

export type NativeDisplay = {
  index: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  primary: boolean;
  name: string;
};

export type NativeDesktopLayout = {
  displays: NativeDisplay[];
  virtualScreen: { left: number; top: number; width: number; height: number };
};

export type NativeCaptureStart =
  | {
      ok: true;
      originX: number;
      originY: number;
      captureWidth: number;
      captureHeight: number;
      frameWidth: number;
      frameHeight: number;
    }
  | { ok: false; error: string };

export type NativeFrame = {
  frameId: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  jpeg: Buffer;
};

/**
 * Boundary implemented by `apps/desktop/native/win32`.
 * Loaded only on win32, and only from the main process.
 */
export type Win32NativeAddon = {
  abi: number;
  getDesktopLayout(): NativeDesktopLayout;
  startCapture(displayIndex: number, maxFrameWidth: number): NativeCaptureStart;
  stopCapture(): void;
  acquireFrame(sinceFrameId: number): NativeFrame | null;
  sendInputs(commands: Win32InputCommand[]): number;
  probeH264(): H264Probe;
};

export function win32AddonCandidates(moduleDir: string): string[] {
  return [
    path.join(moduleDir, ADDON_FILE),
    path.resolve(moduleDir, "..", "native", "win32", "build", "Release", ADDON_FILE),
  ];
}

export function loadWin32AddonAt(options: {
  platform: string;
  candidates: string[];
  exists: (file: string) => boolean;
  load: (file: string) => unknown;
  onError?: (file: string, error: unknown) => void;
}): Win32NativeAddon | null {
  if (options.platform !== "win32") return null;
  const onError = options.onError ?? ((file, error) => console.error("[native] failed to load", file, error));
  for (const candidate of options.candidates) {
    if (!options.exists(candidate)) continue;
    try {
      const loaded = options.load(candidate);
      if (isAddon(loaded)) return loaded;
    } catch (error) {
      onError(candidate, error);
    }
  }
  return null;
}

let cached: Win32NativeAddon | null | undefined;

export function getWin32Addon(): Win32NativeAddon | null {
  if (cached !== undefined) return cached;
  // Electron runs the esbuild CJS bundle. `__dirname` is `dist/`, next to the
  // copied `.node`. `import.meta.url` is empty in that bundle.
  const moduleDir = __dirname;
  const requireNative = createRequire(__filename);
  cached = loadWin32AddonAt({
    platform: process.platform,
    candidates: win32AddonCandidates(moduleDir),
    exists: (file) => fs.existsSync(file),
    load: (file) => requireNative(file) as unknown,
  });
  if (cached) console.log("[native] loaded screen_sharing_win32");
  else if (process.platform === "win32") console.warn("[native] screen_sharing_win32.node not found; build it with npm run build:native -w @screen-sharing/desktop");
  return cached;
}

function isAddon(value: unknown): value is Win32NativeAddon {
  if (!value || typeof value !== "object") return false;
  const addon = value as Partial<Win32NativeAddon>;
  return (
    addon.abi === WIN32_ADDON_ABI &&
    typeof addon.getDesktopLayout === "function" &&
    typeof addon.startCapture === "function" &&
    typeof addon.stopCapture === "function" &&
    typeof addon.acquireFrame === "function" &&
    typeof addon.sendInputs === "function" &&
    typeof addon.probeH264 === "function"
  );
}
