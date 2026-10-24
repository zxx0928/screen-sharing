/**
 * Signaling and TURN settings for the desktop client.
 *
 * Dev (`npm run dev`) reads process environment variables. Keys are the same
 * ones documented in docs/network.md: SIGNALING_URL, STUN_URLS, TURN_URLS,
 * TURN_USERNAME, TURN_CREDENTIAL, ICE_TRANSPORT_POLICY.
 *
 * An installed or portable build also reads a JSON object with those keys.
 * The file never lives in git. Environment variables override the file.
 * This module has no default host and no built-in password.
 */

import path from "node:path";
import type { EnvLike, IceConfig } from "./ice-config";

export const CLIENT_CONFIG_KEYS = [
  "SIGNALING_URL",
  "STUN_URLS",
  "TURN_URLS",
  "TURN_USERNAME",
  "TURN_CREDENTIAL",
  "ICE_TRANSPORT_POLICY",
] as const;

export type ClientConfigKey = (typeof CLIENT_CONFIG_KEYS)[number];

/** JSON object written by the operator. Unknown keys are ignored. */
export type ClientConfigFile = Partial<Record<ClientConfigKey, string>>;

export const DEFAULT_SIGNALING_URL = "ws://127.0.0.1:8787";

const MAX_CONFIG_VALUE = 2048;

export type ConfigLocations = {
  /** `true` for the packaged exe, `false` for `electron .`. */
  isPackaged: boolean;
  /** Directory that contains the executable. */
  execDir: string;
  /** `app.getPath("userData")`. Used only by the packaged app. */
  userDataDir: string;
  /** Working directory. Dev reads `xiaoxu.config.json` from here. */
  cwd: string;
};

/**
 * Files to read, lowest priority first. A later file overrides earlier keys.
 * Process environment still wins over every file.
 *
 * Packaged: per-user `config.json`, then `xiaoxu.config.json` beside the exe
 * (the portable copy). Dev: only `xiaoxu.config.json` in the working directory,
 * so a leftover installed config does not change `npm run dev`.
 */
export function configFileCandidates(locations: ConfigLocations): string[] {
  if (locations.isPackaged) {
    return [
      path.join(locations.userDataDir, "config.json"),
      path.join(locations.execDir, "xiaoxu.config.json"),
    ];
  }
  return [path.join(locations.cwd, "xiaoxu.config.json")];
}

export function parseClientConfigJson(text: string): { ok: true; value: ClientConfigFile } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "expected an object" };
  }
  const record = parsed as Record<string, unknown>;
  const value: ClientConfigFile = {};
  for (const key of CLIENT_CONFIG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const raw = record[key];
    if (typeof raw !== "string") return { ok: false, error: `${key} must be a string` };
    if (raw.length > MAX_CONFIG_VALUE) return { ok: false, error: `${key} is too long` };
    if (key === "TURN_CREDENTIAL") {
      if (raw.length > 0) value[key] = raw;
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed.length > 0) value[key] = trimmed;
  }
  return { ok: true, value };
}

/**
 * Merge file layers. `candidates` is lowest priority first.
 * `readFile` returns null when the file is absent. It must not throw.
 */
export function loadClientConfigFiles(options: {
  candidates: string[];
  readFile: (file: string) => string | null;
  warn: (message: string) => void;
}): { values: ClientConfigFile; sources: string[] } {
  const values: ClientConfigFile = {};
  const sources: string[] = [];
  for (const file of options.candidates) {
    const text = options.readFile(file);
    if (text === null) continue;
    const parsed = parseClientConfigJson(text);
    if (!parsed.ok) {
      options.warn(`[config] skipped ${file} (${parsed.error})`);
      continue;
    }
    const keys = CLIENT_CONFIG_KEYS.filter((key) => parsed.value[key] !== undefined);
    if (keys.length === 0) continue;
    for (const key of keys) values[key] = parsed.value[key];
    sources.push(file);
  }
  return { values, sources };
}

/** True when this environment variable should override the JSON file. */
export function envSupplies(env: EnvLike, key: ClientConfigKey): boolean {
  const value = env[key];
  if (value === undefined) return false;
  if (key === "TURN_CREDENTIAL") return value.length > 0;
  return value.trim().length > 0;
}

/**
 * File values first, then a non-empty environment variable.
 * The result only contains client config keys. TURN_CREDENTIAL is not trimmed.
 */
export function mergeClientEnv(env: EnvLike, file: ClientConfigFile): EnvLike {
  const merged: EnvLike = {};
  for (const key of CLIENT_CONFIG_KEYS) {
    const fromFile = file[key];
    if (typeof fromFile === "string" && fromFile.length > 0) merged[key] = fromFile;
    if (!envSupplies(env, key)) continue;
    const fromEnv = env[key] ?? "";
    merged[key] = key === "TURN_CREDENTIAL" ? fromEnv : fromEnv.trim();
  }
  return merged;
}

/**
 * Accept only `ws:` / `wss:` URLs with no username or password.
 * Anything else falls back to the local default. The warning does not echo
 * the rejected value, because it might be a URL with embedded secrets.
 */
export function readSignalingUrl(raw: string | undefined, warn: (message: string) => void = () => undefined): string {
  if (raw === undefined || raw.trim() === "") return DEFAULT_SIGNALING_URL;
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    warn("[config] SIGNALING_URL is not a ws:// or wss:// URL; using ws://127.0.0.1:8787");
    return DEFAULT_SIGNALING_URL;
  }
  if ((url.protocol !== "ws:" && url.protocol !== "wss:") || url.username !== "" || url.password !== "" || url.hostname === "") {
    warn("[config] SIGNALING_URL is not a ws:// or wss:// URL without userinfo; using ws://127.0.0.1:8787");
    return DEFAULT_SIGNALING_URL;
  }
  return value;
}

/**
 * One startup line. URLs and policy only — no TURN username or password.
 * `source` lists the files that contributed keys, then `env` when an
 * environment variable won. `files` lists every place we look, lowest
 * priority first.
 */
export function describeClientConfig(input: {
  signalingUrl: string;
  ice: IceConfig;
  fileSources: string[];
  envOverride: boolean;
  candidates: string[];
}): string {
  const turn = input.ice.iceServers.some((server) =>
    server.urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:")),
  );
  const layers = input.fileSources.map((file) => `file:${file}`);
  if (input.envOverride) layers.push("env");
  const source = layers.length > 0 ? layers.join(" < ") : "default";
  const files = input.candidates.map((file, index) => `${index + 1}:${file}`).join(" ");
  return `signaling=${input.signalingUrl} turn=${turn ? "yes" : "no"} policy=${input.ice.iceTransportPolicy} source=${source} files=${files} (later file overrides earlier; environment overrides files)`;
}
