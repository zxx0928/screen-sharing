import assert from "node:assert/strict";
import test from "node:test";
import { describeIceConfig, readIceConfig } from "./ice-config";

test("default ICE config is public STUN and does not force relay", () => {
  const warnings: string[] = [];
  const config = readIceConfig({}, (message) => warnings.push(message));
  assert.deepEqual(config, {
    iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
    iceTransportPolicy: "all",
  });
  assert.deepEqual(warnings, []);
  assert.equal(describeIceConfig(config).includes("19302"), true);
});

test("TURN urls pick up the username and credential and the log line omits both", () => {
  const config = readIceConfig({
    TURN_URLS: " turn:turn.example.com:3478?transport=udp, turns:turn.example.com:5349?transport=tcp ",
    TURN_USERNAME: "screen-user",
    TURN_CREDENTIAL: "super-secret-value",
    ICE_TRANSPORT_POLICY: "relay",
  });
  assert.equal(config.iceTransportPolicy, "relay");
  assert.deepEqual(config.iceServers[1], {
    urls: ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349?transport=tcp"],
    username: "screen-user",
    credential: "super-secret-value",
  });
  const line = describeIceConfig(config);
  assert.equal(line.includes("super-secret-value"), false);
  assert.equal(line.includes("screen-user"), false);
  assert.match(line, /policy=relay/);
  assert.match(line, /turn=yes/);
  assert.match(line, /turn:turn\.example\.com:3478\?transport=udp/);
});

test("TURN without a credential is dropped instead of being sent to the browser", () => {
  const warnings: string[] = [];
  const config = readIceConfig({ TURN_URLS: "turn:turn.example.com:3478", TURN_USERNAME: "screen-user" }, (message) =>
    warnings.push(message),
  );
  assert.equal(config.iceServers.some((server) => server.username), false);
  assert.equal(warnings.some((message) => message.includes("TURN_CREDENTIAL")), true);
});

test("embedded TURN secrets are rejected and not repeated in the warning", () => {
  const warnings: string[] = [];
  const config = readIceConfig(
    {
      TURN_URLS: "turn:screen-user:super-secret-value@turn.example.com:3478",
      TURN_USERNAME: "screen-user",
      TURN_CREDENTIAL: "other",
    },
    (message) => warnings.push(message),
  );
  assert.equal(config.iceServers.some((server) => server.urls.some((url) => url.startsWith("turn:"))), false);
  const text = warnings.join("\n");
  assert.match(text, /embedded credentials/);
  assert.equal(text.includes("super-secret-value"), false);
});

test("STUN_URLS=none disables STUN and an explicit list replaces the default", () => {
  const none = readIceConfig({ STUN_URLS: "none" });
  assert.deepEqual(none.iceServers, []);
  const custom = readIceConfig({ STUN_URLS: "stun:stun.example.com:19302" });
  assert.deepEqual(custom.iceServers, [{ urls: ["stun:stun.example.com:19302"] }]);
});

test("relay without TURN warns, and an unknown policy stays on all", () => {
  const relayWarnings: string[] = [];
  const relay = readIceConfig({ ICE_TRANSPORT_POLICY: "relay" }, (message) => relayWarnings.push(message));
  assert.equal(relay.iceTransportPolicy, "relay");
  assert.match(relayWarnings.join("\n"), /no TURN server/);

  const unknownWarnings: string[] = [];
  const unknown = readIceConfig({ ICE_TRANSPORT_POLICY: "force" }, (message) => unknownWarnings.push(message));
  assert.equal(unknown.iceTransportPolicy, "all");
  assert.match(unknownWarnings.join("\n"), /unknown ICE_TRANSPORT_POLICY/);
});
