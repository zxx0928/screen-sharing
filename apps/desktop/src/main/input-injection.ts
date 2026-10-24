import type { InputEvent } from "@screen-sharing/protocol";

/**
 * Windows input injection extension point.
 *
 * Phase 1 logs a few events and does not touch the OS.
 *
 * TODO(windows-input): load a win32 N-API addon from this main process and
 * call SendInput. The renderer only forwards events; it cannot inject.
 *
 * Expected addon behavior:
 * - `mouse-move` x/y are 0..1 across the captured video frame (the controller
 *   already removed letterboxing). Map them with the capture origin:
 *   pixelX = originX + x * captureWidth, pixelY = originY + y * captureHeight.
 *   Multi-monitor origins are not always (0, 0).
 * - `mouse-button` / `mouse-wheel` use the same pointer. Wheel deltas are DOM
 *   WheelEvent deltas (positive deltaY scrolls down), not Win32 notches.
 * - `key.code` is a W3C KeyboardEvent.code (`KeyA`, `ShiftLeft`). Map it to a
 *   scan code. Ignore auto-repeat; the controller does not send it.
 * - On session end, send key-up for every key this session pressed so a
 *   dropped connection cannot leave Shift or Ctrl stuck.
 *
 * TODO(macos): CGEvent injection, same function, `darwin` only.
 */

let mouseMovesLogged = 0;
let sawInput = false;

export function injectInput(event: InputEvent): void {
  sawInput = true;
  if (event.type === "mouse-move") {
    mouseMovesLogged += 1;
    if (mouseMovesLogged > 3) return;
  }
  console.log("[input] stub", JSON.stringify(event));
  // TODO(windows-input): nativeInject(event);
}

export function releaseInjectedInput(): void {
  if (!sawInput) return;
  sawInput = false;
  mouseMovesLogged = 0;
  console.log("[input] session end — release stub");
  // TODO(windows-input): key-up for every modifier this session pressed.
}
