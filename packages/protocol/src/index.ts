/**
 * Shared contract for the 1:1 remote desktop.
 *
 * Two planes:
 * 1. WebSocket signaling — device-code rooms plus opaque SDP/ICE relay.
 *    The signaling server never sees pixels or keystrokes.
 * 2. WebRTC DataChannel "input" — mouse and keyboard from the controller
 *    to the host, plus the host's share/control policy back to the controller.
 *    Those messages are defined here so both peers agree, but they do not
 *    travel through the signaling server. Stopping the share is not `leave`.
 *
 * Roles are fixed for a room: `host` is the controlled computer (the one
 * showing the device code). `controller` is the person operating it.
 * A room holds at most one of each. This is not a meeting.
 */

/** WebRTC DataChannel label used for remote input and session policy. Keep both peers in sync. */
export const INPUT_CHANNEL_LABEL = "input";

/**
 * Host starts sending a screen track as soon as the controller joins.
 * Stopping later removes that track only — the room and peer connection stay up.
 */
export const DEFAULT_SHARING_ENABLED = true;

/**
 * Remote control is off until the host explicitly allows it.
 * While this is false the host must not call SendInput.
 */
export const DEFAULT_REMOTE_CONTROL_ENABLED = false;

/** Device codes are 9 digits, the same shape as ToDesk / Sunflower codes. */
export const DEVICE_CODE_LENGTH = 9;

/** Temporary room passwords are admission secrets, not user accounts. */
export const TEMP_PASSWORD_MAX_LENGTH = 64;

export type Role = "host" | "controller";

export type ErrorCode =
  | "room-not-found"
  | "room-full"
  | "bad-password"
  | "invalid-message"
  | "not-in-room"
  | "already-in-room"
  | "not-host"
  | "peer-not-ready";

/**
 * Session description negotiated by the browser WebRTC stack.
 * `sdp` is opaque to the signaling server — do not parse or rewrite it here.
 */
export type SessionDescriptionPayload = {
  type: "offer" | "answer";
  sdp: string;
};

/** Subset of RTCIceCandidateInit that we actually relay. */
export type RtcIceCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

/** Trickled ICE candidate. `null` marks end-of-candidates and is ignored. */
export type IceCandidatePayload = {
  type: "ice";
  candidate: RtcIceCandidate | null;
};

export type RtcSignal = SessionDescriptionPayload | IceCandidatePayload;

/**
 * Mouse / keyboard event produced by the controller.
 * Carried as JSON on the input DataChannel, then (later) injected on the host.
 */
export type InputEvent =
  | MouseMoveEvent
  | MouseButtonEvent
  | MouseWheelEvent
  | KeyEvent;

/**
 * Pointer position on the remote video frame.
 * `x` and `y` are fractions of the video content box (letterboxing already
 * removed), origin top-left, range 0..1. They are not physical pixels —
 * the host maps them onto the captured display.
 */
export type MouseMoveEvent = {
  type: "mouse-move";
  x: number;
  y: number;
  normalized: true;
};

/** Button on the controller's pointing device. */
export type MouseButtonEvent = {
  type: "mouse-button";
  button: "left" | "right" | "middle";
  action: "down" | "up";
};

/**
 * Wheel delta from the controller's DOM WheelEvent.
 * Positive `deltaY` means scroll down, matching the browser, not Win32.
 */
export type MouseWheelEvent = {
  type: "mouse-wheel";
  deltaX: number;
  deltaY: number;
};

/**
 * Physical key, using the W3C `KeyboardEvent.code` value (`KeyA`, `ShiftLeft`).
 * Layout-independent so the host injector does not guess the controller's locale.
 * Auto-repeat keydowns are not sent; the host OS repeats while the key is down.
 */
export type KeyEvent = {
  type: "key";
  code: string;
  action: "down" | "up";
};

/**
 * Host → controller on the input DataChannel.
 * `sharing: false` means the host is not sending a screen track. The signaling
 * room is unchanged. `control: false` means the host will not inject input.
 */
export type SessionState = {
  type: "session-state";
  sharing: boolean;
  control: boolean;
};

/** Controller → host. Asks for a fresh `session-state` (the first one can race the listener). */
export type SessionSync = {
  type: "session-sync";
};

export type DataChannelControl = SessionState | SessionSync;

/** Messages a client may send to the signaling server. Role is assigned by the server. */
export type ClientMessage =
  | { type: "create-room"; password?: string }
  | { type: "join-room"; code: string; password?: string }
  | { type: "set-password"; password?: string }
  | { type: "signal"; payload: RtcSignal }
  | { type: "leave" };

/** Messages the signaling server sends to a client. */
export type ServerMessage =
  | { type: "room-created"; code: string; role: "host" }
  | { type: "joined"; code: string; role: "controller" }
  | { type: "peer-joined"; role: Role }
  | { type: "peer-left"; role: Role }
  | { type: "signal"; from: Role; payload: RtcSignal }
  | { type: "password-updated"; enabled: boolean }
  | { type: "error"; code: ErrorCode; message: string };

/**
 * Strip spaces and hyphens from a typed device code.
 * Returns the 9-digit room id, or null when the value is not a device code.
 */
export function normalizeDeviceCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  if (digits.length !== DEVICE_CODE_LENGTH || !/^\d{9}$/.test(digits)) return null;
  return digits;
}

/** Display form `123 456 789`. Non-codes are returned unchanged. */
export function formatDeviceCode(code: string): string {
  const normalized = normalizeDeviceCode(code);
  if (!normalized) return code;
  return `${normalized.slice(0, 3)} ${normalized.slice(3, 6)} ${normalized.slice(6)}`;
}

/**
 * Normalize a temporary password.
 * - `undefined` result: empty / whitespace, meaning "no password".
 * - `null`: rejected (too long or contains control characters).
 */
export function normalizeTemporaryPassword(value: string): string | undefined | null {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > TEMP_PASSWORD_MAX_LENGTH) return null;
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return null;
  return trimmed;
}

export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "create-room":
      return withOptionalPassword(value.password, (password) =>
        password === undefined ? { type: "create-room" } : { type: "create-room", password },
      );
    case "join-room": {
      if (typeof value.code !== "string") return null;
      const code = normalizeDeviceCode(value.code);
      if (!code) return null;
      return withOptionalPassword(value.password, (password) =>
        password === undefined ? { type: "join-room", code } : { type: "join-room", code, password },
      );
    }
    case "set-password":
      return withOptionalPassword(value.password, (password) =>
        password === undefined ? { type: "set-password" } : { type: "set-password", password },
      );
    case "signal": {
      const payload = parseRtcSignal(value.payload);
      return payload ? { type: "signal", payload } : null;
    }
    case "leave":
      return { type: "leave" };
    default:
      return null;
  }
}

export function parseServerMessage(value: unknown): ServerMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "room-created":
      return typeof value.code === "string" && normalizeDeviceCode(value.code) && value.role === "host"
        ? { type: "room-created", code: value.code, role: "host" }
        : null;
    case "joined":
      return typeof value.code === "string" && normalizeDeviceCode(value.code) && value.role === "controller"
        ? { type: "joined", code: value.code, role: "controller" }
        : null;
    case "peer-joined":
      return isRole(value.role) ? { type: "peer-joined", role: value.role } : null;
    case "peer-left":
      return isRole(value.role) ? { type: "peer-left", role: value.role } : null;
    case "signal": {
      if (!isRole(value.from)) return null;
      const payload = parseRtcSignal(value.payload);
      return payload ? { type: "signal", from: value.from, payload } : null;
    }
    case "password-updated":
      return typeof value.enabled === "boolean" ? { type: "password-updated", enabled: value.enabled } : null;
    case "error":
      return isErrorCode(value.code) && typeof value.message === "string"
        ? { type: "error", code: value.code, message: value.message }
        : null;
    default:
      return null;
  }
}

export function parseDataChannelControl(value: unknown): DataChannelControl | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "session-sync") return { type: "session-sync" };
  if (value.type === "session-state") {
    if (typeof value.sharing !== "boolean" || typeof value.control !== "boolean") return null;
    return { type: "session-state", sharing: value.sharing, control: value.control };
  }
  return null;
}

export function serializeSessionState(sharing: boolean, control: boolean): string {
  const message: SessionState = { type: "session-state", sharing, control };
  return JSON.stringify(message);
}

export function serializeSessionSync(): string {
  const message: SessionSync = { type: "session-sync" };
  return JSON.stringify(message);
}

export function parseInputEvent(value: unknown): InputEvent | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "mouse-move": {
      if (value.normalized !== true || !isUnit(value.x) || !isUnit(value.y)) return null;
      return { type: "mouse-move", x: value.x, y: value.y, normalized: true };
    }
    case "mouse-button": {
      if (!isMouseButton(value.button) || !isPressAction(value.action)) return null;
      return { type: "mouse-button", button: value.button, action: value.action };
    }
    case "mouse-wheel": {
      if (!isFiniteNumber(value.deltaX) || !isFiniteNumber(value.deltaY)) return null;
      if (Math.abs(value.deltaX) > 100_000 || Math.abs(value.deltaY) > 100_000) return null;
      return { type: "mouse-wheel", deltaX: value.deltaX, deltaY: value.deltaY };
    }
    case "key": {
      if (typeof value.code !== "string" || !isPressAction(value.action)) return null;
      if (!/^[A-Za-z0-9]{1,32}$/.test(value.code)) return null;
      return { type: "key", code: value.code, action: value.action };
    }
    default:
      return null;
  }
}

function parseRtcSignal(value: unknown): RtcSignal | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "offer" || value.type === "answer") {
    if (typeof value.sdp !== "string" || value.sdp.length === 0 || value.sdp.length > 200_000) return null;
    return { type: value.type, sdp: value.sdp };
  }
  if (value.type === "ice") {
    if (value.candidate === null) return { type: "ice", candidate: null };
    if (!isRecord(value.candidate) || typeof value.candidate.candidate !== "string") return null;
    if (value.candidate.candidate.length === 0 || value.candidate.candidate.length > 4096) return null;
    const candidate: RtcIceCandidate = { candidate: value.candidate.candidate };
    if (value.candidate.sdpMid === null || typeof value.candidate.sdpMid === "string") {
      if (typeof value.candidate.sdpMid === "string" && value.candidate.sdpMid.length > 64) return null;
      if (value.candidate.sdpMid !== undefined) candidate.sdpMid = value.candidate.sdpMid;
    } else if (value.candidate.sdpMid !== undefined) {
      return null;
    }
    if (value.candidate.sdpMLineIndex === null || typeof value.candidate.sdpMLineIndex === "number") {
      if (
        typeof value.candidate.sdpMLineIndex === "number" &&
        (!Number.isInteger(value.candidate.sdpMLineIndex) || value.candidate.sdpMLineIndex < 0)
      ) {
        return null;
      }
      if (value.candidate.sdpMLineIndex !== undefined) candidate.sdpMLineIndex = value.candidate.sdpMLineIndex;
    } else if (value.candidate.sdpMLineIndex !== undefined) {
      return null;
    }
    if (value.candidate.usernameFragment === null || typeof value.candidate.usernameFragment === "string") {
      if (typeof value.candidate.usernameFragment === "string" && value.candidate.usernameFragment.length > 256) {
        return null;
      }
      if (value.candidate.usernameFragment !== undefined) {
        candidate.usernameFragment = value.candidate.usernameFragment;
      }
    } else if (value.candidate.usernameFragment !== undefined) {
      return null;
    }
    return { type: "ice", candidate };
  }
  return null;
}

function withOptionalPassword<T>(value: unknown, build: (password: string | undefined) => T): T | null {
  if (value === undefined) return build(undefined);
  if (typeof value !== "string") return null;
  const password = normalizeTemporaryPassword(value);
  if (password === null) return null;
  return build(password);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRole(value: unknown): value is Role {
  return value === "host" || value === "controller";
}

function isErrorCode(value: unknown): value is ErrorCode {
  return (
    value === "room-not-found" ||
    value === "room-full" ||
    value === "bad-password" ||
    value === "invalid-message" ||
    value === "not-in-room" ||
    value === "already-in-room" ||
    value === "not-host" ||
    value === "peer-not-ready"
  );
}

function isMouseButton(value: unknown): value is MouseButtonEvent["button"] {
  return value === "left" || value === "right" || value === "middle";
}

function isPressAction(value: unknown): value is "down" | "up" {
  return value === "down" || value === "up";
}

function isUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
