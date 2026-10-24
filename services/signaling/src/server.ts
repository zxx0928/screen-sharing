import { randomUUID } from "node:crypto";
import {
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
  parseClientMessage,
} from "@screen-sharing/protocol";
import { WebSocket, WebSocketServer } from "ws";
import { RoomRegistry } from "./rooms.js";

/**
 * Device-code signaling.
 *
 * A host creates a room and receives a 9-digit code. A controller joins that
 * code (and the optional temporary password). SDP and ICE are relayed to the
 * other peer and never inspected. The second controller is rejected — this
 * product is 1:1 remote desktop, not a meeting.
 *
 * Rooms live in memory only. Restarting the process invalidates every code.
 *
 * Share on/off and remote-control permission are not room events. They travel
 * on the input DataChannel (`session-state`). Stopping the picture must not
 * look like `leave`: the device-code room stays up.
 */

const MAX_PAYLOAD_BYTES = 256 * 1024;
const HEARTBEAT_MS = 30_000;

const ERROR_TEXT: Record<ErrorCode, string> = {
  "room-not-found": "No device is using that code",
  "room-full": "That device already has a controller",
  "bad-password": "Temporary password was rejected",
  "invalid-message": "Message was not understood",
  "not-in-room": "Not in a room",
  "already-in-room": "Already in a room",
  "not-host": "Only the host can do that",
  "peer-not-ready": "The other peer is not connected",
};

type Connection = {
  id: string;
  socket: WebSocket;
};

export type SignalingHandle = {
  port: number;
  close: () => Promise<void>;
};

export function startSignalingServer(port: number, host = "127.0.0.1"): Promise<SignalingHandle> {
  const registry = new RoomRegistry();
  const connections = new Map<string, Connection>();
  const wss = new WebSocketServer({ port, host, maxPayload: MAX_PAYLOAD_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();

  const timer = setInterval(() => {
    for (const socket of wss.clients) {
      if (alive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, HEARTBEAT_MS);

  function close(): Promise<void> {
    clearInterval(timer);
    for (const socket of wss.clients) socket.terminate();
    return new Promise((resolve, reject) => {
      wss.close((error) => (error ? reject(error) : resolve()));
    });
  }

  function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function sendError(socket: WebSocket, code: ErrorCode): void {
    send(socket, { type: "error", code, message: ERROR_TEXT[code] });
  }

  function notifyLeave(clientId: string): void {
    const left = registry.leave(clientId);
    if (!left?.peerId) return;
    const peer = connections.get(left.peerId);
    if (!peer) return;
    log("peer-left", { code: left.code, role: left.role });
    send(peer.socket, { type: "peer-left", role: left.role });
  }

  function handleMessage(conn: Connection, message: ClientMessage): void {
    switch (message.type) {
      case "create-room": {
        const created = registry.create(conn.id, message.password);
        if (!created.ok) {
          sendError(conn.socket, created.error);
          return;
        }
        log("room-created", { code: created.room.code });
        send(conn.socket, { type: "room-created", code: created.room.code, role: "host" });
        return;
      }
      case "join-room": {
        const joined = registry.join(conn.id, message.code, message.password);
        if (!joined.ok) {
          log("join-rejected", { code: message.code, error: joined.error });
          sendError(conn.socket, joined.error);
          return;
        }
        log("joined", { code: joined.room.code });
        send(conn.socket, { type: "joined", code: joined.room.code, role: "controller" });
        const host = connections.get(joined.peerId);
        if (host) send(host.socket, { type: "peer-joined", role: "controller" });
        return;
      }
      case "set-password": {
        const updated = registry.setPassword(conn.id, message.password);
        if (!updated.ok) {
          sendError(conn.socket, updated.error);
          return;
        }
        send(conn.socket, { type: "password-updated", enabled: updated.enabled });
        return;
      }
      case "signal": {
        const relay = registry.relay(conn.id);
        if ("error" in relay) {
          sendError(conn.socket, relay.error);
          return;
        }
        const peer = connections.get(relay.peerId);
        if (!peer) {
          sendError(conn.socket, "peer-not-ready");
          return;
        }
        log("signal", { code: relay.code, from: relay.role, kind: message.payload.type });
        send(peer.socket, { type: "signal", from: relay.role, payload: message.payload });
        return;
      }
      case "leave":
        notifyLeave(conn.id);
        return;
      default: {
        const unreachable: never = message;
        return unreachable;
      }
    }
  }

  wss.on("connection", (socket) => {
    const conn: Connection = { id: randomUUID(), socket };
    connections.set(conn.id, conn);
    alive.set(socket, true);
    log("connect", { id: conn.id });

    socket.on("pong", () => alive.set(socket, true));
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        sendError(socket, "invalid-message");
        return;
      }
      const text = typeof data === "string" ? data : data.toString();
      let json: unknown;
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        sendError(socket, "invalid-message");
        return;
      }
      const message = parseClientMessage(json);
      if (!message) {
        sendError(socket, "invalid-message");
        return;
      }
      handleMessage(conn, message);
    });
    socket.on("close", () => {
      connections.delete(conn.id);
      notifyLeave(conn.id);
      log("disconnect", { id: conn.id });
    });
    socket.on("error", (error) => {
      console.error(`[signaling] socket error id=${conn.id} ${error.message}`);
    });
  });

  return new Promise((resolve, reject) => {
    wss.once("listening", () => {
      const address = wss.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({ port: actualPort, close });
    });
    wss.once("error", (error) => {
      clearInterval(timer);
      reject(error);
    });
  });
}

function log(event: string, fields: Record<string, string>): void {
  const suffix = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.log(`[signaling] ${event}${suffix ? ` ${suffix}` : ""}`);
}
