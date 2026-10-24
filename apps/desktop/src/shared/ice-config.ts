/**
 * ICE servers for the 1:1 session.
 *
 * The desktop main process reads this from the environment and hands the
 * result to the renderer. TURN usernames and passwords stay in the
 * environment — nothing in this module has a built-in credential.
 *
 * Without TURN_URLS the session uses host candidates plus STUN. That is
 * enough on one machine and on most LANs. Two machines behind different
 * NATs need a reachable coturn (or equivalent) listed in TURN_URLS.
 */

export type IceTransportPolicy = "all" | "relay";

/** One RTCIceServer entry. `urls` is always an array after parsing. */
export type IceServer = {
  urls: string[];
  /** Long-term TURN username. Absent on STUN entries. */
  username?: string;
  /** Long-term TURN password. Absent on STUN entries. Never log this. */
  credential?: string;
};

export type IceConfig = {
  iceServers: IceServer[];
  iceTransportPolicy: IceTransportPolicy;
};

export type EnvLike = Record<string, string | undefined>;

const DEFAULT_STUN_URLS = ["stun:stun.l.google.com:19302"];
const MAX_URLS = 8;
const MAX_USERNAME = 128;
const MAX_CREDENTIAL = 256;

const ICE_URL =
  /^(stun|stuns|turn|turns):(?:\[[0-9a-fA-F:.]+\]|[A-Za-z0-9._-]+)(?::(\d{1,5}))?(?:\?[A-Za-z0-9._~%=&-]*)?$/;

export function readIceConfig(
  env: EnvLike,
  warn: (message: string) => void = (message) => console.warn(message),
): IceConfig {
  const stunUrls = readStunUrls(env.STUN_URLS, warn);
  const turn = readTurnServer(env, warn);
  const iceServers: IceServer[] = [];
  if (stunUrls.length > 0) iceServers.push({ urls: stunUrls });
  if (turn) iceServers.push(turn);
  return {
    iceServers,
    iceTransportPolicy: readPolicy(env.ICE_TRANSPORT_POLICY, Boolean(turn), warn),
  };
}

/**
 * One line for logs. URLs only — usernames and credentials are omitted.
 */
export function describeIceConfig(config: IceConfig): string {
  const urls = config.iceServers.flatMap((server) => server.urls);
  const turn = urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:"));
  return `policy=${config.iceTransportPolicy} turn=${turn ? "yes" : "no"} urls=${urls.join(",") || "none"}`;
}

function readStunUrls(raw: string | undefined, warn: (message: string) => void): string[] {
  if (raw === undefined || raw.trim() === "") return [...DEFAULT_STUN_URLS];
  if (/^(none|off|false)$/i.test(raw.trim())) return [];
  const urls = acceptUrls(raw, "stun", warn);
  if (urls.length > 0) return urls;
  warn("[ice] STUN_URLS had no usable stun/stuns url; using the default STUN server");
  return [...DEFAULT_STUN_URLS];
}

function readTurnServer(env: EnvLike, warn: (message: string) => void): IceServer | null {
  const raw = env.TURN_URLS;
  if (raw === undefined || raw.trim() === "") return null;
  const urls = acceptUrls(raw, "turn", warn);
  if (urls.length === 0) {
    warn("[ice] TURN_URLS had no usable turn/turns url; continuing without TURN");
    return null;
  }
  const username = env.TURN_USERNAME?.trim() ?? "";
  const credential = env.TURN_CREDENTIAL ?? "";
  if (!username || !credential) {
    warn("[ice] TURN_URLS is set but TURN_USERNAME or TURN_CREDENTIAL is empty; continuing without TURN");
    return null;
  }
  if (username.length > MAX_USERNAME || credential.length > MAX_CREDENTIAL) {
    warn("[ice] TURN username or credential is too long; continuing without TURN");
    return null;
  }
  return { urls, username, credential };
}

function readPolicy(raw: string | undefined, hasTurn: boolean, warn: (message: string) => void): IceTransportPolicy {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "" || value === "all") return "all";
  if (value === "relay") {
    if (!hasTurn) warn("[ice] ICE_TRANSPORT_POLICY=relay but no TURN server is configured; cross-network calls will fail");
    return "relay";
  }
  warn(`[ice] unknown ICE_TRANSPORT_POLICY ${JSON.stringify(value)}; using all`);
  return "all";
}

function acceptUrls(raw: string, kind: "stun" | "turn", warn: (message: string) => void): string[] {
  const accepted: string[] = [];
  for (const piece of raw.split(",")) {
    if (accepted.length >= MAX_URLS) {
      warn(`[ice] ignoring extra ${kind} urls beyond ${MAX_URLS}`);
      break;
    }
    const url = piece.trim();
    if (!url) continue;
    if (url.includes("@") || url.includes("://")) {
      warn(`[ice] skipped a ${kind} url with embedded credentials or a scheme the browser will not use. Use ${kind}:host:port and put secrets in TURN_USERNAME / TURN_CREDENTIAL`);
      continue;
    }
    const match = ICE_URL.exec(url);
    if (!match || !match[1].startsWith(kind)) {
      warn(`[ice] skipped a ${kind} url that is not ${kind}: or ${kind}s:`);
      continue;
    }
    const port = match[2];
    if (port !== undefined && Number(port) > 65535) {
      warn(`[ice] skipped a ${kind} url with an invalid port`);
      continue;
    }
    accepted.push(url);
  }
  return accepted;
}
