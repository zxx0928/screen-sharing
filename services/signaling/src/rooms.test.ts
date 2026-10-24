import assert from "node:assert/strict";
import test from "node:test";
import { RoomRegistry } from "./rooms.js";

test("host creates a room and a controller joins with the password", () => {
  const registry = new RoomRegistry(() => "123456789");
  const created = registry.create("host", "secret");
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.room.code, "123456789");

  assert.deepEqual(registry.join("wrong", "123456789", "nope"), { ok: false, error: "bad-password" });
  const joined = registry.join("controller", "123456789", "secret");
  assert.equal(joined.ok, true);
  assert.deepEqual(registry.join("other", "123456789", "secret"), { ok: false, error: "room-full" });
});

test("a controller leaving frees the seat and the host leaving deletes the room", () => {
  const registry = new RoomRegistry(() => "123456789");
  registry.create("host");
  registry.join("controller", "123456789");
  const left = registry.leave("controller");
  assert.equal(left?.roomDeleted, false);
  assert.equal(left?.peerId, "host");

  const again = registry.join("next", "123456789");
  assert.equal(again.ok, true);

  const hostLeft = registry.leave("host");
  assert.equal(hostLeft?.roomDeleted, true);
  assert.equal(registry.join("someone", "123456789").ok, false);
  const relay = registry.relay("next");
  assert.equal("error" in relay && relay.error, "not-in-room");
});

test("relay waits until both peers exist", () => {
  let n = 0;
  const registry = new RoomRegistry(() => {
    n += 1;
    return n < 3 ? "111111111" : "222222222";
  });
  const first = registry.create("host-a");
  const second = registry.create("host-b");
  assert.equal(first.ok && first.room.code, "111111111");
  assert.equal(second.ok && second.room.code, "222222222");

  assert.deepEqual(registry.relay("host-a"), { error: "peer-not-ready" });
  registry.join("controller", "111111111");
  assert.deepEqual(registry.relay("host-a"), { peerId: "controller", role: "host", code: "111111111" });
  assert.deepEqual(registry.relay("controller"), { peerId: "host-a", role: "controller", code: "111111111" });
});

test("only the host can change the temporary password", () => {
  const registry = new RoomRegistry(() => "123456789");
  registry.create("host");
  registry.join("controller", "123456789");
  assert.deepEqual(registry.setPassword("controller", "nope"), { ok: false, error: "not-host" });
  assert.deepEqual(registry.setPassword("host", "temp"), { ok: true, enabled: true });
  registry.leave("controller");
  assert.deepEqual(registry.join("next", "123456789"), { ok: false, error: "bad-password" });
  assert.equal(registry.join("next", "123456789", "temp").ok, true);
  assert.deepEqual(registry.setPassword("host", undefined), { ok: true, enabled: false });
});

test("the host can end the session and keep the same device code", () => {
  const registry = new RoomRegistry(() => "123456789");
  registry.create("host");
  registry.join("controller", "123456789");
  assert.deepEqual(registry.endSession("controller"), { ok: false, error: "not-host" });
  const ended = registry.endSession("host");
  assert.deepEqual(ended, { ok: true, code: "123456789", peerId: "controller" });
  assert.equal(registry.join("next", "123456789").ok, true);
  assert.deepEqual(registry.relay("next"), { peerId: "host", role: "controller", code: "123456789" });
  assert.deepEqual(registry.endSession("missing"), { ok: false, error: "not-in-room" });
});

test("unknown device codes do not join and a client cannot open two rooms", () => {
  const registry = new RoomRegistry(() => "123456789");
  assert.deepEqual(registry.join("c", "000000000"), { ok: false, error: "room-not-found" });
  assert.equal(registry.create("host").ok, true);
  assert.deepEqual(registry.create("host"), { ok: false, error: "already-in-room" });
});
