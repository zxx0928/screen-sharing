import assert from "node:assert/strict";
import test from "node:test";
import type { InputEvent } from "@screen-sharing/protocol";
import { InjectionSession } from "./injection-session";
import { KEYEVENTF_KEYUP, type InjectionTarget } from "./input-mapping";
import { RemoteControlGate } from "./remote-control";

const primary: InjectionTarget = {
  capture: { originX: 0, originY: 0, width: 1920, height: 1080 },
  virtualScreen: { left: 0, top: 0, width: 1920, height: 1080 },
};

test("remote control is off by default and dropped events never become SendInput commands", () => {
  const session = new InjectionSession();
  const gate = new RemoteControlGate(session);
  assert.equal(gate.isAllowed(), false);

  assert.deepEqual(gate.commandsFor(key("KeyA", "down"), null), []);
  assert.deepEqual(gate.commandsFor(move(0.5, 0.5), primary), []);
  assert.deepEqual(session.release(), []);
  assert.deepEqual(gate.setAllowed(false), { changed: false, release: [] });
});

test("turning remote control on maps keys, and turning it off releases them", () => {
  const gate = new RemoteControlGate(new InjectionSession());
  assert.deepEqual(gate.setAllowed(true), { changed: true, release: [] });

  const down = gate.commandsFor(key("KeyA", "down"), null);
  assert.equal(down.length, 1);
  assert.equal(down[0]?.type, "key");

  const stopped = gate.setAllowed(false);
  assert.equal(stopped.changed, true);
  assert.equal(stopped.release.length, 1);
  assert.equal(stopped.release[0]?.type, "key");
  if (stopped.release[0]?.type !== "key") return;
  assert.ok((stopped.release[0].flags & KEYEVENTF_KEYUP) !== 0);

  assert.deepEqual(gate.commandsFor(key("KeyA", "up"), null), []);
  assert.deepEqual(gate.commandsFor(move(0.2, 0.2), primary), []);
  assert.equal(gate.isAllowed(), false);
});

test("a second allow does not emit another release batch", () => {
  const gate = new RemoteControlGate(new InjectionSession());
  gate.setAllowed(true);
  gate.commandsFor(key("ShiftLeft", "down"), null);
  gate.setAllowed(false);
  assert.deepEqual(gate.setAllowed(false), { changed: false, release: [] });
});

function key(code: string, action: "down" | "up"): InputEvent {
  return { type: "key", code, action };
}

function move(x: number, y: number): InputEvent {
  return { type: "mouse-move", x, y, normalized: true };
}
