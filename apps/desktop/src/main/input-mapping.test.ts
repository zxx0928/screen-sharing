import assert from "node:assert/strict";
import test from "node:test";
import type { InputEvent } from "@screen-sharing/protocol";
import { InjectionSession } from "./injection-session";
import {
  ABSOLUTE_MOUSE_MAX,
  KEYEVENTF_EXTENDEDKEY,
  KEYEVENTF_KEYUP,
  KEYEVENTF_SCANCODE,
  MOUSEEVENTF_ABSOLUTE,
  MOUSEEVENTF_HWHEEL,
  MOUSEEVENTF_LEFTDOWN,
  MOUSEEVENTF_LEFTUP,
  MOUSEEVENTF_MOVE,
  MOUSEEVENTF_VIRTUALDESK,
  MOUSEEVENTF_WHEEL,
  domWheelToWin32,
  isUsableTarget,
  keyCommand,
  mapNormalizedToPixel,
  mapPixelToAbsolute,
  type InjectionTarget,
  type Win32InputCommand,
} from "./input-mapping";
import { dispatchWin32Inputs } from "./win32-dispatch";

const primary: InjectionTarget = {
  capture: { originX: 0, originY: 0, width: 1920, height: 1080 },
  virtualScreen: { left: 0, top: 0, width: 1920, height: 1080 },
};

const leftOfPair: InjectionTarget = {
  capture: { originX: -1920, originY: 0, width: 1920, height: 1080 },
  virtualScreen: { left: -1920, top: 0, width: 3840, height: 1080 },
};

test("normalized coordinates land on the captured output, including a negative origin", () => {
  assert.deepEqual(mapNormalizedToPixel(0, 0, primary.capture), { x: 0, y: 0 });
  assert.deepEqual(mapNormalizedToPixel(1, 1, primary.capture), { x: 1919, y: 1079 });
  assert.deepEqual(mapNormalizedToPixel(0, 0, leftOfPair.capture), { x: -1920, y: 0 });
  assert.deepEqual(mapNormalizedToPixel(1, 1, leftOfPair.capture), { x: -1, y: 1079 });
});

test("SendInput absolute coordinates cover the virtual screen, not only the primary monitor", () => {
  assert.equal(mapPixelToAbsolute(0, 0, 1920), 0);
  assert.equal(mapPixelToAbsolute(1919, 0, 1920), ABSOLUTE_MOUSE_MAX);
  assert.equal(mapPixelToAbsolute(-1920, -1920, 3840), 0);
  assert.equal(mapPixelToAbsolute(1919, -1920, 3840), ABSOLUTE_MOUSE_MAX);
  assert.equal(mapPixelToAbsolute(-1, -1920, 3840), 32759);
  assert.equal(mapPixelToAbsolute(1079, 0, 1080), ABSOLUTE_MOUSE_MAX);
});

test("a move on the left monitor becomes a virtual-desktop absolute move", () => {
  const session = new InjectionSession();
  const [move] = session.apply(moveEvent(0, 0), leftOfPair);
  assert.equal(move?.type, "mouse");
  if (move?.type !== "mouse") return;
  assert.equal(move.dx, 0);
  assert.equal(move.dy, 0);
  assert.equal(move.mouseData, 0);
  assert.equal(move.flags, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK);

  const [far] = session.apply(moveEvent(1, 1), leftOfPair);
  if (far?.type !== "mouse") throw new Error("expected mouse command");
  assert.equal(far.dx, 32759);
  assert.equal(far.dy, ABSOLUTE_MOUSE_MAX);
});

test("mouse buttons are real button flags and repeat the last absolute position", () => {
  const session = new InjectionSession();
  session.apply(moveEvent(0.5, 0.25), primary);
  const commands = session.apply({ type: "mouse-button", button: "left", action: "down" }, primary);
  assert.equal(commands.length, 2);
  assert.equal(commands[0]?.type, "mouse");
  assert.equal(commands[1]?.type, "mouse");
  if (commands[1]?.type !== "mouse" || commands[0]?.type !== "mouse") return;
  assert.equal(commands[1].flags, MOUSEEVENTF_LEFTDOWN);
  assert.equal(commands[0].flags & MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_ABSOLUTE);
  const released = session.release();
  assert.deepEqual(released, [{ type: "mouse", dx: 0, dy: 0, mouseData: 0, flags: MOUSEEVENTF_LEFTUP }]);
});

test("wheel deltas flip the vertical axis and keep the horizontal axis", () => {
  assert.equal(domWheelToWin32(100, "vertical"), -120);
  assert.equal(domWheelToWin32(-100, "vertical"), 120);
  assert.equal(domWheelToWin32(3, "vertical"), -360);
  assert.equal(domWheelToWin32(100, "horizontal"), 120);
  assert.equal(domWheelToWin32(0, "vertical"), 0);

  const session = new InjectionSession();
  session.apply(moveEvent(0, 0), primary);
  const commands = session.apply({ type: "mouse-wheel", deltaX: 100, deltaY: 100 }, primary);
  const wheel = commands.filter((command) => command.type === "mouse" && (command.flags & MOUSEEVENTF_WHEEL) !== 0);
  const hwheel = commands.filter((command) => command.type === "mouse" && (command.flags & MOUSEEVENTF_HWHEEL) !== 0);
  assert.equal(wheel[0]?.type === "mouse" ? wheel[0].mouseData : null, -120);
  assert.equal(hwheel[0]?.type === "mouse" ? hwheel[0].mouseData : null, 120);
});

test("keys use set-1 scan codes and release clears every held modifier", () => {
  assert.deepEqual(keyCommand("KeyA", "down"), { type: "key", scan: 0x1e, flags: KEYEVENTF_SCANCODE });
  assert.deepEqual(keyCommand("KeyA", "up"), {
    type: "key",
    scan: 0x1e,
    flags: KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP,
  });
  assert.deepEqual(keyCommand("ArrowLeft", "down"), {
    type: "key",
    scan: 0x4b,
    flags: KEYEVENTF_SCANCODE | KEYEVENTF_EXTENDEDKEY,
  });
  assert.equal(keyCommand("Pause", "down"), null);

  const session = new InjectionSession();
  assert.deepEqual(session.apply({ type: "key", code: "NotAKey", action: "down" }, primary), []);
  session.apply({ type: "key", code: "ShiftLeft", action: "down" }, null);
  session.apply({ type: "key", code: "ControlLeft", action: "down" }, null);
  session.apply({ type: "key", code: "KeyA", action: "down" }, null);
  session.apply({ type: "key", code: "KeyA", action: "up" }, null);
  const released = session.release();
  assert.deepEqual(
    released.map((command) => (command.type === "key" ? command.scan : 0)),
    [0x2a, 0x1d],
  );
  assert.ok(released.every((command) => command.type === "key" && (command.flags & KEYEVENTF_KEYUP) !== 0));
  assert.deepEqual(session.release(), []);
});

test("mouse events without a usable target are dropped and do not reach SendInput", () => {
  const outside: InjectionTarget = {
    capture: { originX: -1920, originY: 0, width: 1920, height: 1080 },
    virtualScreen: { left: 0, top: 0, width: 1920, height: 1080 },
  };
  assert.equal(isUsableTarget(outside), false);
  assert.equal(isUsableTarget(primary), true);
  const session = new InjectionSession();
  assert.deepEqual(session.apply(moveEvent(0.2, 0.2), outside), []);
  assert.deepEqual(session.apply(moveEvent(0.2, 0.2), null), []);
});

test("dispatch calls sendInputs with the mapped batch", () => {
  const session = new InjectionSession();
  const commands = session.apply({ type: "key", code: "KeyA", action: "down" }, null);
  const seen: Win32InputCommand[][] = [];
  const sent = dispatchWin32Inputs(
    {
      sendInputs(batch) {
        seen.push(batch);
        return batch.length;
      },
    },
    commands,
  );
  assert.equal(sent, 1);
  assert.deepEqual(seen, [commands]);
  assert.equal(dispatchWin32Inputs(null, commands), 0);
  assert.equal(
    dispatchWin32Inputs(
      {
        sendInputs() {
          throw new Error("empty batch must not call SendInput");
        },
      },
      [],
    ),
    0,
  );
});

function moveEvent(x: number, y: number): InputEvent {
  return { type: "mouse-move", x, y, normalized: true };
}
