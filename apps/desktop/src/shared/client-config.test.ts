import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readIceConfig } from "./ice-config";
import {
  configFileCandidates,
  describeClientConfig,
  loadClientConfigFiles,
  mergeClientEnv,
  parseClientConfigJson,
  readSignalingUrl,
} from "./client-config";

const SECRET = "super-secret-value";
const USER = "screen-user";

test("packaged config files are userData then the file beside the exe", () => {
  const files = configFileCandidates({
    isPackaged: true,
    execDir: "D:\\XiaoxuConnect",
    userDataDir: "C:\\Users\\me\\AppData\\Roaming\\小旭连接",
    cwd: "C:\\ignored",
  });
  assert.deepEqual(files, [
    path.join("C:\\Users\\me\\AppData\\Roaming\\小旭连接", "config.json"),
    path.join("D:\\XiaoxuConnect", "xiaoxu.config.json"),
  ]);
});

test("dev reads only the working-directory file", () => {
  const files = configFileCandidates({
    isPackaged: false,
    execDir: "/usr/lib/electron",
    userDataDir: "/home/me/.config/小旭连接",
    cwd: "/repo/apps/desktop",
  });
  assert.deepEqual(files, [path.join("/repo/apps/desktop", "xiaoxu.config.json")]);
});

test("a later file overrides an earlier one and env overrides both", () => {
  const loaded = loadClientConfigFiles({
    candidates: ["user.json", "portable.json"],
    readFile: (file) => {
      if (file === "user.json") {
        return JSON.stringify({
          SIGNALING_URL: "ws://203.0.113.10:8787",
          TURN_URLS: "turn:turn.example.com:3478",
          TURN_USERNAME: USER,
          TURN_CREDENTIAL: SECRET,
        });
      }
      return JSON.stringify({ SIGNALING_URL: "ws://198.51.100.20:8787" });
    },
    warn: () => undefined,
  });
  assert.deepEqual(loaded.sources, ["user.json", "portable.json"]);
  const merged = mergeClientEnv({ SIGNALING_URL: "ws://192.0.2.30:8787" }, loaded.values);
  assert.equal(merged.SIGNALING_URL, "ws://192.0.2.30:8787");
  assert.equal(merged.TURN_CREDENTIAL, SECRET);
  const ice = readIceConfig(merged);
  assert.equal(ice.iceServers[1]?.credential, SECRET);
  assert.equal(readSignalingUrl(merged.SIGNALING_URL), "ws://192.0.2.30:8787");
});

test("an empty environment variable does not hide the file", () => {
  const merged = mergeClientEnv(
    { SIGNALING_URL: "  ", TURN_CREDENTIAL: "" },
    {
      SIGNALING_URL: "ws://203.0.113.10:8787",
      TURN_URLS: "turn:turn.example.com:3478",
      TURN_USERNAME: USER,
      TURN_CREDENTIAL: ` ${SECRET} `,
      ICE_TRANSPORT_POLICY: "relay",
    },
  );
  assert.equal(merged.SIGNALING_URL, "ws://203.0.113.10:8787");
  assert.equal(merged.TURN_CREDENTIAL, ` ${SECRET} `);
  const ice = readIceConfig(merged);
  assert.equal(ice.iceTransportPolicy, "relay");
  assert.equal(ice.iceServers[1]?.credential, ` ${SECRET} `);
});

test("invalid JSON is skipped and the warning does not include the file body", () => {
  const warnings: string[] = [];
  const loaded = loadClientConfigFiles({
    candidates: ["broken.json", "ok.json"],
    readFile: (file) => (file === "broken.json" ? `{"TURN_CREDENTIAL":"${SECRET}"` : `{"SIGNALING_URL":"ws://203.0.113.10:8787"}`),
    warn: (message) => warnings.push(message),
  });
  assert.equal(loaded.values.SIGNALING_URL, "ws://203.0.113.10:8787");
  assert.equal(loaded.values.TURN_CREDENTIAL, undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /invalid JSON/);
  assert.equal((warnings[0] ?? "").includes(SECRET), false);
});

test("non-string values and embedded signaling secrets are rejected without being echoed", () => {
  const parsed = parseClientConfigJson(`{"SIGNALING_URL":1,"TURN_CREDENTIAL":"${SECRET}"}`);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.match(parsed.error, /SIGNALING_URL must be a string/);
    assert.equal(parsed.error.includes(SECRET), false);
  }

  const warnings: string[] = [];
  const url = readSignalingUrl(`ws://user:${SECRET}@203.0.113.10:8787`, (message) => warnings.push(message));
  assert.equal(url, "ws://127.0.0.1:8787");
  assert.equal(warnings.join("\n").includes(SECRET), false);
  assert.equal(readSignalingUrl("http://203.0.113.10:8787"), "ws://127.0.0.1:8787");
  assert.equal(readSignalingUrl("wss://signal.example.com/ws"), "wss://signal.example.com/ws");
});

test("the startup line lists files and omits TURN secrets", () => {
  const merged = mergeClientEnv(
    {},
    {
      SIGNALING_URL: "ws://203.0.113.10:8787",
      TURN_URLS: "turn:turn.example.com:3478?transport=udp",
      TURN_USERNAME: USER,
      TURN_CREDENTIAL: SECRET,
    },
  );
  const ice = readIceConfig(merged);
  const line = describeClientConfig({
    signalingUrl: readSignalingUrl(merged.SIGNALING_URL),
    ice,
    fileSources: ["C:/Users/me/config.json"],
    envOverride: false,
    candidates: ["C:/Users/me/config.json", "D:/XiaoxuConnect/xiaoxu.config.json"],
  });
  assert.match(line, /signaling=ws:\/\/203\.0\.113\.10:8787/);
  assert.match(line, /turn=yes/);
  assert.match(line, /source=file:C:\/Users\/me\/config\.json/);
  assert.match(line, /1:C:\/Users\/me\/config\.json 2:D:\/XiaoxuConnect\/xiaoxu\.config\.json/);
  assert.match(line, /later file overrides earlier/);
  assert.equal(line.includes(SECRET), false);
  assert.equal(line.includes(USER), false);
});

test("empty example values do not count as a configured source", () => {
  const loaded = loadClientConfigFiles({
    candidates: ["example.json"],
    readFile: () =>
      JSON.stringify({
        SIGNALING_URL: "",
        STUN_URLS: "",
        TURN_URLS: "  ",
        TURN_USERNAME: "",
        TURN_CREDENTIAL: "",
        ICE_TRANSPORT_POLICY: "",
      }),
    warn: () => undefined,
  });
  assert.deepEqual(loaded, { values: {}, sources: [] });
  const line = describeClientConfig({
    signalingUrl: readSignalingUrl(undefined),
    ice: readIceConfig({}),
    fileSources: [],
    envOverride: false,
    candidates: ["example.json"],
  });
  assert.match(line, /source=default/);
  assert.match(line, /signaling=ws:\/\/127\.0\.0\.1:8787/);
});
