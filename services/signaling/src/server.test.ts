import assert from "node:assert/strict";
import test from "node:test";
import { parseServerMessage, type ServerMessage } from "@screen-sharing/protocol";
import { WebSocket } from "ws";
import { startSignalingServer } from "./server.js";

test("device-code room relays one offer and rejects a second controller", async () => {
  const server = await startSignalingServer(0);
  const sockets: WebSocket[] = [];
  try {
    const host = await connect(server.port);
    sockets.push(host);
    const createdWait = takeMessage(host);
    host.send(JSON.stringify({ type: "create-room", password: "secret1" }));
    const created = await createdWait;
    assert.equal(created.type, "room-created");
    if (created.type !== "room-created") return;

    const bad = await connect(server.port);
    sockets.push(bad);
    const badWait = takeMessage(bad);
    bad.send(JSON.stringify({ type: "join-room", code: created.code, password: "nope" }));
    const rejected = await badWait;
    assert.equal(rejected.type, "error");
    if (rejected.type === "error") assert.equal(rejected.code, "bad-password");

    const controller = await connect(server.port);
    sockets.push(controller);
    const joinedWait = takeMessage(controller);
    const peerWait = takeMessage(host);
    controller.send(JSON.stringify({ type: "join-room", code: ` ${created.code} `, password: "secret1" }));
    const joined = await joinedWait;
    const peer = await peerWait;
    assert.equal(joined.type, "joined");
    assert.deepEqual(peer, { type: "peer-joined", role: "controller" });

    const full = await connect(server.port);
    sockets.push(full);
    const fullWait = takeMessage(full);
    full.send(JSON.stringify({ type: "join-room", code: created.code, password: "secret1" }));
    const fullMessage = await fullWait;
    assert.equal(fullMessage.type, "error");
    if (fullMessage.type === "error") assert.equal(fullMessage.code, "room-full");

    const offerWait = takeMessage(controller);
    host.send(JSON.stringify({ type: "signal", payload: { type: "offer", sdp: "v=0" } }));
    const offer = await offerWait;
    assert.deepEqual(offer, { type: "signal", from: "host", payload: { type: "offer", sdp: "v=0" } });

    const leftWait = takeMessage(host);
    controller.send(JSON.stringify({ type: "leave" }));
    const left = await leftWait;
    assert.deepEqual(left, { type: "peer-left", role: "controller" });

    const invalidWait = takeMessage(host);
    host.send("not-json");
    const invalid = await invalidWait;
    assert.equal(invalid.type, "error");
    if (invalid.type === "error") assert.equal(invalid.code, "invalid-message");
  } finally {
    for (const socket of sockets) socket.close();
    await server.close();
  }
});

test("closing the host socket removes the room", async () => {
  const server = await startSignalingServer(0);
  const host = await connect(server.port);
  try {
    const createdWait = takeMessage(host);
    host.send(JSON.stringify({ type: "create-room" }));
    const created = await createdWait;
    assert.equal(created.type, "room-created");
    if (created.type !== "room-created") return;
    host.close();
    await waitForClose(host);

    const controller = await connect(server.port);
    try {
      const missingWait = takeMessage(controller);
      controller.send(JSON.stringify({ type: "join-room", code: created.code }));
      const missing = await missingWait;
      assert.equal(missing.type, "error");
      if (missing.type === "error") assert.equal(missing.code, "room-not-found");
    } finally {
      controller.close();
    }
  } finally {
    host.close();
    await server.close();
  }
});

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function takeMessage(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for signaling message")), 2000);
    socket.once("message", (data) => {
      clearTimeout(timer);
      const text = typeof data === "string" ? data : data.toString();
      let json: unknown;
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        reject(new Error(`invalid json: ${text}`));
        return;
      }
      const parsed = parseServerMessage(json);
      if (!parsed) {
        reject(new Error(`unparsed message: ${text}`));
        return;
      }
      resolve(parsed);
    });
  });
}

function waitForClose(socket: WebSocket): Promise<void> {
  if (socket.readyState === socket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => socket.once("close", () => resolve()));
}
