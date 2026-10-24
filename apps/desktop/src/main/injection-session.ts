import type { InputEvent } from "@screen-sharing/protocol";
import {
  MOUSEEVENTF_HWHEEL,
  MOUSEEVENTF_WHEEL,
  domWheelToWin32,
  isUsableTarget,
  keyCommand,
  mapNormalizedToPixel,
  mouseButtonFlag,
  mouseMoveCommand,
  type InjectionTarget,
  type MouseButton,
  type Win32InputCommand,
} from "./input-mapping";

/**
 * Turns protocol input into `SendInput` commands and remembers keys and
 * buttons that must be released if the DataChannel drops.
 */
export class InjectionSession {
  private readonly heldKeys = new Set<string>();
  private readonly heldButtons = new Set<MouseButton>();
  private lastPixel: { x: number; y: number } | null = null;

  apply(event: InputEvent, target: InjectionTarget | null): Win32InputCommand[] {
    if (event.type === "key") return this.applyKey(event.code, event.action);
    if (!target || !isUsableTarget(target)) return [];
    switch (event.type) {
      case "mouse-move":
        return this.applyMove(event.x, event.y, target);
      case "mouse-button":
        return this.applyButton(event.button, event.action, target);
      case "mouse-wheel":
        return this.applyWheel(event.deltaX, event.deltaY, target);
      default:
        return [];
    }
  }

  /** Key-up / button-up for everything this session is still holding. */
  release(): Win32InputCommand[] {
    const commands: Win32InputCommand[] = [];
    for (const code of this.heldKeys) {
      const command = keyCommand(code, "up");
      if (command) commands.push(command);
    }
    this.heldKeys.clear();
    for (const button of this.heldButtons) {
      commands.push({ type: "mouse", dx: 0, dy: 0, mouseData: 0, flags: mouseButtonFlag(button, "up") });
    }
    this.heldButtons.clear();
    this.lastPixel = null;
    return commands;
  }

  private applyMove(x: number, y: number, target: InjectionTarget): Win32InputCommand[] {
    const pixel = mapNormalizedToPixel(x, y, target.capture);
    this.lastPixel = pixel;
    return [mouseMoveCommand(pixel.x, pixel.y, target.virtualScreen)];
  }

  private applyButton(button: MouseButton, action: "down" | "up", target: InjectionTarget): Win32InputCommand[] {
    const commands: Win32InputCommand[] = [];
    if (this.lastPixel) commands.push(mouseMoveCommand(this.lastPixel.x, this.lastPixel.y, target.virtualScreen));
    commands.push({ type: "mouse", dx: 0, dy: 0, mouseData: 0, flags: mouseButtonFlag(button, action) });
    if (action === "down") this.heldButtons.add(button);
    else this.heldButtons.delete(button);
    return commands;
  }

  private applyWheel(deltaX: number, deltaY: number, target: InjectionTarget): Win32InputCommand[] {
    const commands: Win32InputCommand[] = [];
    if (this.lastPixel) commands.push(mouseMoveCommand(this.lastPixel.x, this.lastPixel.y, target.virtualScreen));
    const vertical = domWheelToWin32(deltaY, "vertical");
    const horizontal = domWheelToWin32(deltaX, "horizontal");
    if (vertical !== 0) {
      commands.push({ type: "mouse", dx: 0, dy: 0, mouseData: vertical, flags: MOUSEEVENTF_WHEEL });
    }
    if (horizontal !== 0) {
      commands.push({ type: "mouse", dx: 0, dy: 0, mouseData: horizontal, flags: MOUSEEVENTF_HWHEEL });
    }
    return commands;
  }

  private applyKey(code: string, action: "down" | "up"): Win32InputCommand[] {
    const command = keyCommand(code, action);
    if (!command) return [];
    if (action === "down") this.heldKeys.add(code);
    else this.heldKeys.delete(code);
    return [command];
  }
}
