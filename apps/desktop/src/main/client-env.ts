import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { DesktopConfig } from "../shared/desktop-api";
import { describeIceConfig, readIceConfig } from "../shared/ice-config";
import {
  CLIENT_CONFIG_KEYS,
  configFileCandidates,
  describeClientConfig,
  envSupplies,
  loadClientConfigFiles,
  mergeClientEnv,
  readSignalingUrl,
} from "../shared/client-config";

const MAX_FILE_BYTES = 16_384;
const EXAMPLE_NAME = "xiaoxu.config.example.json";

/**
 * Resolve the signaling URL and ICE servers for this process.
 *
 * Packaged builds read `%APPDATA%/小旭连接/config.json` (or the platform
 * userData folder) and then `xiaoxu.config.json` next to the executable.
 * Dev reads `xiaoxu.config.json` from the working directory. A non-empty
 * environment variable overrides the file. See docs/download.md.
 */
export function resolveDesktopConfig(warn: (message: string) => void = (message) => console.warn(message)): DesktopConfig {
  const userDataDir = app.getPath("userData");
  const locations = {
    isPackaged: app.isPackaged,
    execDir: path.dirname(process.execPath),
    userDataDir,
    cwd: process.cwd(),
  };
  const candidates = configFileCandidates(locations);
  const loaded = loadClientConfigFiles({
    candidates,
    readFile(file) {
      return readConfigText(file, warn);
    },
    warn,
  });
  const env = mergeClientEnv(process.env, loaded.values);
  const ice = readIceConfig(env, warn);
  const signalingUrl = readSignalingUrl(env.SIGNALING_URL, warn);
  const envOverride = CLIENT_CONFIG_KEYS.some((key) => envSupplies(process.env, key));
  console.log(
    `[config] ${describeClientConfig({
      signalingUrl,
      ice,
      fileSources: loaded.sources,
      envOverride,
      candidates,
    })}`,
  );
  console.log(`[ice] ${describeIceConfig(ice)}`);
  if (app.isPackaged) copyExample(userDataDir, warn);
  return {
    signalingUrl,
    platform: process.platform,
    iceServers: ice.iceServers,
    iceTransportPolicy: ice.iceTransportPolicy,
  };
}

function readConfigText(file: string, warn: (message: string) => void): string | null {
  try {
    if (!fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
      warn(`[config] skipped ${file}`);
      return null;
    }
    return fs.readFileSync(file, "utf8");
  } catch {
    warn(`[config] skipped ${file}`);
    return null;
  }
}

function copyExample(userDataDir: string, warn: (message: string) => void): void {
  const dest = path.join(userDataDir, "config.example.json");
  if (fs.existsSync(dest)) return;
  const source = [path.join(path.dirname(process.execPath), EXAMPLE_NAME), path.join(process.resourcesPath, EXAMPLE_NAME)].find(
    (file) => fs.existsSync(file),
  );
  if (!source) return;
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.copyFileSync(source, dest);
    console.log(`[config] wrote example ${dest}`);
  } catch {
    warn(`[config] could not write ${dest}`);
  }
}
