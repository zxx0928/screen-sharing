import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_REMOTE_CONTROL_ENABLED,
  DEFAULT_SHARING_ENABLED,
  formatDeviceCode,
  normalizeDeviceCode,
  normalizeTemporaryPassword,
  parseClientMessage,
  parseDataChannelControl,
  parseInputEvent,
  parseServerMessage,
  serializeSessionState,
  serializeSessionSync,
} from "./index.js";

test("device codes ignore spaces and hyphens", () => {
  assert.equal(normalizeDeviceCode("123 456 789"), "123456789");
  assert.equal(normalizeDeviceCode("123-456-789"), "123456789");
  assert.equal(normalizeDeviceCode("12345678"), null);
  assert.equal(normalizeDeviceCode("1234567890"), null);
  assert.equal(formatDeviceCode("123456789"), "123 456 789");
});

test("temporary passwords treat blank as unset and reject control characters", () => {
  assert.equal(normalizeTemporaryPassword("  "), undefined);
  assert.equal(normalizeTemporaryPassword(" ab12 "), "ab12");
  assert.equal(normalizeTemporaryPassword("bad\npass"), null);
  assert.equal(normalizeTemporaryPassword("x".repeat(65)), null);
});

test("client messages accept a join code with a password and reject garbage", () => {
  assert.deepEqual(parseClientMessage({ type: "join-room", code: "123 456 789", password: "temp" }), {
    type: "join-room",
    code: "123456789",
    password: "temp",
  });
  assert.equal(parseClientMessage({ type: "join-room", code: "12" }), null);
  assert.equal(parseClientMessage({ type: "signal", payload: { type: "offer", sdp: "" } }), null);
  assert.deepEqual(parseClientMessage({ type: "leave", extra: true }), { type: "leave" });
});

test("input events require normalized coordinates and a physical key code", () => {
  assert.deepEqual(parseInputEvent({ type: "mouse-move", x: 0.25, y: 1, normalized: true }), {
    type: "mouse-move",
    x: 0.25,
    y: 1,
    normalized: true,
  });
  assert.equal(parseInputEvent({ type: "mouse-move", x: 12, y: 0, normalized: true }), null);
  assert.equal(parseInputEvent({ type: "key", code: "KeyA", action: "down" })?.type, "key");
  assert.equal(parseInputEvent({ type: "key", code: "a b", action: "down" }), null);
});

test("share starts on connect and remote control stays off until the host allows it", () => {
  assert.equal(DEFAULT_SHARING_ENABLED, true);
  assert.equal(DEFAULT_REMOTE_CONTROL_ENABLED, false);
});

test("session policy rides the datachannel and is not a signaling message", () => {
  assert.deepEqual(parseDataChannelControl({ type: "session-state", sharing: false, control: true }), {
    type: "session-state",
    sharing: false,
    control: true,
  });
  assert.deepEqual(parseDataChannelControl(JSON.parse(serializeSessionState(true, false))), {
    type: "session-state",
    sharing: true,
    control: false,
  });
  assert.deepEqual(parseDataChannelControl(JSON.parse(serializeSessionSync())), { type: "session-sync" });
  assert.equal(parseDataChannelControl({ type: "session-state", sharing: "no", control: false }), null);
  assert.equal(parseDataChannelControl({ type: "session-state", sharing: false }), null);
  assert.equal(parseInputEvent({ type: "session-state", sharing: false, control: false }), null);
  assert.equal(parseClientMessage({ type: "session-state", sharing: false, control: false }), null);
  assert.equal(parseClientMessage({ type: "session-sync" }), null);
  assert.equal(parseClientMessage({ type: "leave" })?.type, "leave");
});

test("server errors keep the stable error code", () => {
  assert.deepEqual(parseServerMessage({ type: "error", code: "room-full", message: "busy" }), {
    type: "error",
    code: "room-full",
    message: "busy",
  });
  assert.equal(parseServerMessage({ type: "error", code: "nope", message: "x" }), null);
});
