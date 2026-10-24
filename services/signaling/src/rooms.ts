import { randomInt } from "node:crypto";
import type { ErrorCode, Role } from "@screen-sharing/protocol";

/**
 * In-memory 1:1 rooms. One host (the controlled device) and at most one
 * controller. Process restart drops every room — that is acceptable for the
 * Phase 1 skeleton. Replace this class if rooms ever need to survive restarts.
 */

export type Room = {
  /** 9-digit device code. This is the room id the controller types. */
  code: string;
  /** Admission secret. Absent means anyone with the code may join. */
  password?: string;
  hostId: string;
  controllerId?: string;
  createdAt: number;
};

export type Membership = {
  code: string;
  role: Role;
};

export type LeaveResult = {
  role: Role;
  code: string;
  roomDeleted: boolean;
  peerId?: string;
};

const CODE_ATTEMPTS = 12;

export function randomDeviceCode(): string {
  return randomInt(0, 1_000_000_000).toString().padStart(9, "0");
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly membership = new Map<string, Membership>();

  constructor(private readonly generateCode: () => string = randomDeviceCode) {}

  create(clientId: string, password?: string): { ok: true; room: Room } | { ok: false; error: ErrorCode } {
    if (this.membership.has(clientId)) return { ok: false, error: "already-in-room" };
    const code = this.allocateCode();
    const room: Room = {
      code,
      hostId: clientId,
      createdAt: Date.now(),
      ...(password ? { password } : {}),
    };
    this.rooms.set(code, room);
    this.membership.set(clientId, { code, role: "host" });
    return { ok: true, room };
  }

  join(
    clientId: string,
    code: string,
    password?: string,
  ): { ok: true; room: Room; peerId: string } | { ok: false; error: ErrorCode } {
    if (this.membership.has(clientId)) return { ok: false, error: "already-in-room" };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: "room-not-found" };
    if (room.controllerId) return { ok: false, error: "room-full" };
    if (!passwordsMatch(room.password, password)) return { ok: false, error: "bad-password" };
    room.controllerId = clientId;
    this.membership.set(clientId, { code, role: "controller" });
    return { ok: true, room, peerId: room.hostId };
  }

  setPassword(
    clientId: string,
    password: string | undefined,
  ): { ok: true; enabled: boolean } | { ok: false; error: ErrorCode } {
    const member = this.membership.get(clientId);
    if (!member) return { ok: false, error: "not-in-room" };
    if (member.role !== "host") return { ok: false, error: "not-host" };
    const room = this.rooms.get(member.code);
    if (!room) return { ok: false, error: "not-in-room" };
    if (password) room.password = password;
    else delete room.password;
    return { ok: true, enabled: Boolean(room.password) };
  }

  /**
   * Host ends the WebRTC session without deleting the device-code room.
   * The controller seat is freed so the next join does not see `room-full`.
   */
  endSession(clientId: string): { ok: true; code: string; peerId?: string } | { ok: false; error: ErrorCode } {
    const member = this.membership.get(clientId);
    if (!member) return { ok: false, error: "not-in-room" };
    if (member.role !== "host") return { ok: false, error: "not-host" };
    const room = this.rooms.get(member.code);
    if (!room) return { ok: false, error: "not-in-room" };
    const peerId = room.controllerId;
    if (!peerId) return { ok: true, code: room.code };
    this.membership.delete(peerId);
    delete room.controllerId;
    return { ok: true, code: room.code, peerId };
  }

  relay(clientId: string): { peerId: string; role: Role; code: string } | { error: ErrorCode } {
    const member = this.membership.get(clientId);
    if (!member) return { error: "not-in-room" };
    const room = this.rooms.get(member.code);
    if (!room) return { error: "not-in-room" };
    const peerId = member.role === "host" ? room.controllerId : room.hostId;
    if (!peerId) return { error: "peer-not-ready" };
    return { peerId, role: member.role, code: room.code };
  }

  leave(clientId: string): LeaveResult | null {
    const member = this.membership.get(clientId);
    if (!member) return null;
    const room = this.rooms.get(member.code);
    this.membership.delete(clientId);
    if (!room) return { role: member.role, code: member.code, roomDeleted: true };
    if (member.role === "host") {
      const peerId = room.controllerId;
      if (peerId) this.membership.delete(peerId);
      this.rooms.delete(room.code);
      return peerId
        ? { role: "host", code: room.code, roomDeleted: true, peerId }
        : { role: "host", code: room.code, roomDeleted: true };
    }
    delete room.controllerId;
    return { role: "controller", code: room.code, roomDeleted: false, peerId: room.hostId };
  }

  private allocateCode(): string {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const code = this.generateCode();
      if (!/^\d{9}$/.test(code)) continue;
      if (this.rooms.has(code)) continue;
      return code;
    }
    throw new Error("Could not allocate a device code");
  }
}

function passwordsMatch(expected: string | undefined, given: string | undefined): boolean {
  if (!expected) return true;
  if (!given || expected.length !== given.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return mismatch === 0;
}
