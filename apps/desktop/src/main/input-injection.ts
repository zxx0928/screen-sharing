import { DEFAULT_REMOTE_CONTROL_ENABLED, type InputEvent } from "@screen-sharing/protocol";
import { InjectionSession } from "./injection-session";
import { isUsableTarget, type InjectionTarget } from "./input-mapping";
import { getWin32Addon } from "./native-addon";
import { RemoteControlGate } from "./remote-control";
import { dispatchWin32Inputs } from "./win32-dispatch";

/**
 * Host input injection. The renderer forwards DataChannel events here.
 * On Windows the commands are passed to `SendInput` through the native addon.
 * Remote control is off until `setRemoteControlAllowed(true)`. While it is
 * off this module returns before the addon, so SendInput is not called.
 * macOS is out of scope (TODO(macos): CGEvent).
 */

const session = new InjectionSession();
const gate = new RemoteControlGate(session, DEFAULT_REMOTE_CONTROL_ENABLED);
let pinnedTarget: InjectionTarget | null = null;
let cachedTarget: { at: number; target: InjectionTarget } | null = null;
let activeDisplayIndex = 0;
let reportedNative = false;
let reportedMissing = false;
let reportedBlocked = false;

export function setActiveDisplayIndex(displayIndex: number): void {
  if (Number.isInteger(displayIndex) && displayIndex >= 0) activeDisplayIndex = displayIndex;
}

/** Called when DXGI duplication starts so the pointer maps onto that output. */
export function noteCaptureGeometry(target: InjectionTarget): void {
  if (!isUsableTarget(target)) {
    console.error("[input] ignored unusable capture geometry");
    return;
  }
  pinnedTarget = target;
  cachedTarget = null;
}

/** Host policy. `false` drops later events and releases anything this session is holding. */
export function setRemoteControlAllowed(allowed: boolean): void {
  const result = gate.setAllowed(allowed);
  if (!result.changed) return;
  reportedBlocked = false;
  if (result.release.length > 0) {
    submit(result.release);
    console.log(`[input] remote control off — released ${result.release.length} held inputs`);
    return;
  }
  console.log(`[input] remote control ${gate.isAllowed() ? "on" : "off"}`);
}

export function injectInput(event: InputEvent): void {
  if (!gate.isAllowed()) {
    if (!reportedBlocked) {
      reportedBlocked = true;
      console.warn("[input] remote control is off; not calling SendInput");
    }
    return;
  }
  submit(gate.commandsFor(event, currentTarget()));
}

export function releaseInjectedInput(): void {
  const result = gate.setAllowed(false);
  pinnedTarget = null;
  cachedTarget = null;
  reportedBlocked = false;
  if (result.release.length === 0) return;
  submit(result.release);
  console.log(`[input] session end — released ${result.release.length} held inputs`);
}

function currentTarget(): InjectionTarget | null {
  if (pinnedTarget) return pinnedTarget;
  if (cachedTarget && Date.now() - cachedTarget.at < 2000) return cachedTarget.target;
  const addon = getWin32Addon();
  if (!addon) return null;
  try {
    const layout = addon.getDesktopLayout();
    const display =
      layout.displays.find((item) => item.index === activeDisplayIndex) ??
      layout.displays.find((item) => item.primary) ??
      layout.displays[0];
    if (!display) return null;
    const target: InjectionTarget = {
      capture: {
        originX: display.originX,
        originY: display.originY,
        width: display.width,
        height: display.height,
      },
      virtualScreen: layout.virtualScreen,
    };
    if (!isUsableTarget(target)) return null;
    cachedTarget = { at: Date.now(), target };
    return target;
  } catch (error) {
    console.error("[input] getDesktopLayout failed", error);
    return null;
  }
}

function submit(commands: ReturnType<InjectionSession["apply"]>): void {
  if (commands.length === 0) return;
  const addon = getWin32Addon();
  if (!addon) {
    if (!reportedMissing) {
      reportedMissing = true;
      console.warn("[input] win32 addon not loaded; not calling SendInput");
    }
    return;
  }
  const sent = dispatchWin32Inputs(addon, commands);
  if (!reportedNative && sent > 0) {
    reportedNative = true;
    console.log("[input] SendInput ready");
  }
  if (sent < 0) console.error("[input] SendInput rejected the batch");
  else if (sent !== commands.length) console.warn(`[input] SendInput accepted ${sent} of ${commands.length}`);
}
