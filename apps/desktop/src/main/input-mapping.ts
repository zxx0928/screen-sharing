/**
 * Win32 input mapping for the host.
 *
 * Controller events are normalized to the captured frame. This module turns
 * them into the exact `INPUT` fields `SendInput` consumes:
 * absolute mouse coordinates on the virtual screen, and set-1 scan codes.
 *
 * The native addon does not reinterpret coordinates. It validates the flags
 * and calls `SendInput`.
 */

export const MOUSEEVENTF_MOVE = 0x0001;
export const MOUSEEVENTF_LEFTDOWN = 0x0002;
export const MOUSEEVENTF_LEFTUP = 0x0004;
export const MOUSEEVENTF_RIGHTDOWN = 0x0008;
export const MOUSEEVENTF_RIGHTUP = 0x0010;
export const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
export const MOUSEEVENTF_MIDDLEUP = 0x0040;
export const MOUSEEVENTF_WHEEL = 0x0800;
export const MOUSEEVENTF_HWHEEL = 0x1000;
export const MOUSEEVENTF_VIRTUALDESK = 0x4000;
export const MOUSEEVENTF_ABSOLUTE = 0x8000;

export const KEYEVENTF_EXTENDEDKEY = 0x0001;
export const KEYEVENTF_KEYUP = 0x0002;
export const KEYEVENTF_SCANCODE = 0x0008;

/** Win32 `WHEEL_DELTA`: one notch. */
export const WHEEL_DELTA = 120;

/**
 * Chromium pixel-mode wheel events are about 100 units per notch.
 * Smaller magnitudes are treated as line mode (typically ±1..3).
 */
export const DOM_PIXEL_NOTCH = 100;

export const ABSOLUTE_MOUSE_MAX = 65535;

export type MouseButton = "left" | "right" | "middle";

/** Physical pixels of the duplicated output. Origin is the virtual screen. */
export type CaptureGeometry = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

/** Union of DXGI output desktop coordinates, in physical pixels. */
export type VirtualScreen = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type InjectionTarget = {
  capture: CaptureGeometry;
  virtualScreen: VirtualScreen;
};

export type Win32MouseCommand = {
  type: "mouse";
  dx: number;
  dy: number;
  mouseData: number;
  flags: number;
};

export type Win32KeyCommand = {
  type: "key";
  scan: number;
  flags: number;
};

export type Win32InputCommand = Win32MouseCommand | Win32KeyCommand;

type ScanCode = { scan: number; extended: boolean };

/**
 * W3C `KeyboardEvent.code` → PC set-1 scan code.
 * Extended keys are the ones whose make code is prefixed with `E0`.
 */
const SCAN_CODES: Record<string, ScanCode> = {
  Escape: { scan: 0x01, extended: false },
  Digit1: { scan: 0x02, extended: false },
  Digit2: { scan: 0x03, extended: false },
  Digit3: { scan: 0x04, extended: false },
  Digit4: { scan: 0x05, extended: false },
  Digit5: { scan: 0x06, extended: false },
  Digit6: { scan: 0x07, extended: false },
  Digit7: { scan: 0x08, extended: false },
  Digit8: { scan: 0x09, extended: false },
  Digit9: { scan: 0x0a, extended: false },
  Digit0: { scan: 0x0b, extended: false },
  Minus: { scan: 0x0c, extended: false },
  Equal: { scan: 0x0d, extended: false },
  Backspace: { scan: 0x0e, extended: false },
  Tab: { scan: 0x0f, extended: false },
  KeyQ: { scan: 0x10, extended: false },
  KeyW: { scan: 0x11, extended: false },
  KeyE: { scan: 0x12, extended: false },
  KeyR: { scan: 0x13, extended: false },
  KeyT: { scan: 0x14, extended: false },
  KeyY: { scan: 0x15, extended: false },
  KeyU: { scan: 0x16, extended: false },
  KeyI: { scan: 0x17, extended: false },
  KeyO: { scan: 0x18, extended: false },
  KeyP: { scan: 0x19, extended: false },
  BracketLeft: { scan: 0x1a, extended: false },
  BracketRight: { scan: 0x1b, extended: false },
  Enter: { scan: 0x1c, extended: false },
  ControlLeft: { scan: 0x1d, extended: false },
  KeyA: { scan: 0x1e, extended: false },
  KeyS: { scan: 0x1f, extended: false },
  KeyD: { scan: 0x20, extended: false },
  KeyF: { scan: 0x21, extended: false },
  KeyG: { scan: 0x22, extended: false },
  KeyH: { scan: 0x23, extended: false },
  KeyJ: { scan: 0x24, extended: false },
  KeyK: { scan: 0x25, extended: false },
  KeyL: { scan: 0x26, extended: false },
  Semicolon: { scan: 0x27, extended: false },
  Quote: { scan: 0x28, extended: false },
  Backquote: { scan: 0x29, extended: false },
  ShiftLeft: { scan: 0x2a, extended: false },
  Backslash: { scan: 0x2b, extended: false },
  KeyZ: { scan: 0x2c, extended: false },
  KeyX: { scan: 0x2d, extended: false },
  KeyC: { scan: 0x2e, extended: false },
  KeyV: { scan: 0x2f, extended: false },
  KeyB: { scan: 0x30, extended: false },
  KeyN: { scan: 0x31, extended: false },
  KeyM: { scan: 0x32, extended: false },
  Comma: { scan: 0x33, extended: false },
  Period: { scan: 0x34, extended: false },
  Slash: { scan: 0x35, extended: false },
  ShiftRight: { scan: 0x36, extended: false },
  NumpadMultiply: { scan: 0x37, extended: false },
  AltLeft: { scan: 0x38, extended: false },
  Space: { scan: 0x39, extended: false },
  CapsLock: { scan: 0x3a, extended: false },
  F1: { scan: 0x3b, extended: false },
  F2: { scan: 0x3c, extended: false },
  F3: { scan: 0x3d, extended: false },
  F4: { scan: 0x3e, extended: false },
  F5: { scan: 0x3f, extended: false },
  F6: { scan: 0x40, extended: false },
  F7: { scan: 0x41, extended: false },
  F8: { scan: 0x42, extended: false },
  F9: { scan: 0x43, extended: false },
  F10: { scan: 0x44, extended: false },
  NumLock: { scan: 0x45, extended: true },
  ScrollLock: { scan: 0x46, extended: false },
  Numpad7: { scan: 0x47, extended: false },
  Numpad8: { scan: 0x48, extended: false },
  Numpad9: { scan: 0x49, extended: false },
  NumpadSubtract: { scan: 0x4a, extended: false },
  Numpad4: { scan: 0x4b, extended: false },
  Numpad5: { scan: 0x4c, extended: false },
  Numpad6: { scan: 0x4d, extended: false },
  NumpadAdd: { scan: 0x4e, extended: false },
  Numpad1: { scan: 0x4f, extended: false },
  Numpad2: { scan: 0x50, extended: false },
  Numpad3: { scan: 0x51, extended: false },
  Numpad0: { scan: 0x52, extended: false },
  NumpadDecimal: { scan: 0x53, extended: false },
  IntlBackslash: { scan: 0x56, extended: false },
  F11: { scan: 0x57, extended: false },
  F12: { scan: 0x58, extended: false },
  NumpadEnter: { scan: 0x1c, extended: true },
  ControlRight: { scan: 0x1d, extended: true },
  NumpadDivide: { scan: 0x35, extended: true },
  PrintScreen: { scan: 0x37, extended: true },
  AltRight: { scan: 0x38, extended: true },
  Home: { scan: 0x47, extended: true },
  ArrowUp: { scan: 0x48, extended: true },
  PageUp: { scan: 0x49, extended: true },
  ArrowLeft: { scan: 0x4b, extended: true },
  ArrowRight: { scan: 0x4d, extended: true },
  End: { scan: 0x4f, extended: true },
  ArrowDown: { scan: 0x50, extended: true },
  PageDown: { scan: 0x51, extended: true },
  Insert: { scan: 0x52, extended: true },
  Delete: { scan: 0x53, extended: true },
  MetaLeft: { scan: 0x5b, extended: true },
  MetaRight: { scan: 0x5c, extended: true },
  ContextMenu: { scan: 0x5d, extended: true },
};

const BUTTON_FLAGS: Record<MouseButton, { down: number; up: number }> = {
  left: { down: MOUSEEVENTF_LEFTDOWN, up: MOUSEEVENTF_LEFTUP },
  right: { down: MOUSEEVENTF_RIGHTDOWN, up: MOUSEEVENTF_RIGHTUP },
  middle: { down: MOUSEEVENTF_MIDDLEDOWN, up: MOUSEEVENTF_MIDDLEUP },
};

export function isUsableTarget(target: InjectionTarget): boolean {
  const { capture, virtualScreen } = target;
  if (!isSaneRect(capture.originX, capture.originY, capture.width, capture.height, 16384)) return false;
  if (!isSaneRect(virtualScreen.left, virtualScreen.top, virtualScreen.width, virtualScreen.height, 65536)) return false;
  if (capture.width < 2 || capture.height < 2) return false;
  if (virtualScreen.width < 2 || virtualScreen.height < 2) return false;
  const right = capture.originX + capture.width;
  const bottom = capture.originY + capture.height;
  const virtualRight = virtualScreen.left + virtualScreen.width;
  const virtualBottom = virtualScreen.top + virtualScreen.height;
  return capture.originX >= virtualScreen.left && capture.originY >= virtualScreen.top && right <= virtualRight && bottom <= virtualBottom;
}

/**
 * Map a 0..1 point on the captured frame to a physical pixel.
 * `x = 1` lands on the last pixel, not one past the right edge.
 */
export function mapNormalizedToPixel(x: number, y: number, capture: CaptureGeometry): { x: number; y: number } {
  const maxX = Math.max(capture.width - 1, 0);
  const maxY = Math.max(capture.height - 1, 0);
  return {
    x: capture.originX + clamp(Math.round(clampUnit(x) * maxX), 0, maxX),
    y: capture.originY + clamp(Math.round(clampUnit(y) * maxY), 0, maxY),
  };
}

/**
 * `MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK` maps 0..65535 across the
 * virtual screen. `span` is the virtual width or height in physical pixels.
 */
export function mapPixelToAbsolute(pixel: number, origin: number, span: number): number {
  if (!Number.isFinite(pixel) || !Number.isFinite(origin) || span <= 1) return 0;
  const relative = pixel - origin;
  const value = Math.round((relative * ABSOLUTE_MOUSE_MAX) / (span - 1));
  return clamp(value, 0, ABSOLUTE_MOUSE_MAX);
}

export function mouseMoveCommand(pixelX: number, pixelY: number, virtualScreen: VirtualScreen): Win32MouseCommand {
  return {
    type: "mouse",
    dx: mapPixelToAbsolute(pixelX, virtualScreen.left, virtualScreen.width),
    dy: mapPixelToAbsolute(pixelY, virtualScreen.top, virtualScreen.height),
    mouseData: 0,
    flags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
  };
}

export function mouseButtonFlag(button: MouseButton, action: "down" | "up"): number {
  const flags = BUTTON_FLAGS[button];
  return action === "down" ? flags.down : flags.up;
}

/**
 * Convert a DOM `WheelEvent` delta into a Win32 wheel `mouseData` value.
 * Vertical: DOM positive (down) becomes Win32 negative.
 * Horizontal: DOM positive (right) stays positive (`MOUSEEVENTF_HWHEEL`).
 */
export function domWheelToWin32(delta: number, axis: "vertical" | "horizontal"): number {
  if (!Number.isFinite(delta) || delta === 0) return 0;
  const magnitude = wheelMagnitude(delta);
  if (magnitude === 0) return 0;
  const domSign = delta > 0 ? 1 : -1;
  const winSign = axis === "horizontal" ? domSign : -domSign;
  return winSign * magnitude;
}

export function keyCommand(code: string, action: "down" | "up"): Win32KeyCommand | null {
  const mapped = SCAN_CODES[code];
  if (!mapped) return null;
  let flags = KEYEVENTF_SCANCODE;
  if (mapped.extended) flags |= KEYEVENTF_EXTENDEDKEY;
  if (action === "up") flags |= KEYEVENTF_KEYUP;
  return { type: "key", scan: mapped.scan, flags };
}

export function knownScanCode(code: string): ScanCode | null {
  return SCAN_CODES[code] ?? null;
}

function wheelMagnitude(delta: number): number {
  const abs = Math.abs(delta);
  const notches = abs < 20 ? abs : abs / DOM_PIXEL_NOTCH;
  return clamp(Math.round(notches * WHEEL_DELTA), 0, 32767);
}

function isSaneRect(x: number, y: number, width: number, height: number, maxSpan: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(width) && Number.isInteger(height) && Math.abs(x) <= 100_000 && Math.abs(y) <= 100_000 && width > 0 && height > 0 && width <= maxSpan && height <= maxSpan;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
