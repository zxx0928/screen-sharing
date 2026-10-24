import {
  INPUT_CHANNEL_LABEL,
  parseDataChannelControl,
  parseInputEvent,
  serializeSessionSync,
  type InputEvent,
  type SessionState,
} from "@screen-sharing/protocol";

export { INPUT_CHANNEL_LABEL };

/**
 * Host side: input events become main-process injection calls when remote
 * control is allowed. `session-sync` asks the host to resend its policy.
 * The main process also drops input while control is off, so a missed check
 * here still cannot reach SendInput.
 */
export function bindHostInputChannel(
  channel: RTCDataChannel,
  controlEnabled: () => boolean,
  onSessionSync: () => void,
): void {
  channel.onmessage = (event) => {
    const json = parseJson(event.data);
    if (!json) return;
    const control = parseDataChannelControl(json);
    if (control?.type === "session-sync") {
      onSessionSync();
      return;
    }
    if (control) return;
    const input = parseInputEvent(json);
    if (!input) {
      console.warn("[input] ignored malformed datachannel payload");
      return;
    }
    if (!controlEnabled()) return;
    window.desktop.injectInput(input);
  };
  channel.onclose = () => {
    window.desktop.endInputSession();
  };
}

/**
 * Controller side: pointer and keyboard on the remote stage become input events.
 * Listeners are removed when the returned function runs.
 */
export function bindControllerInput(
  channel: RTCDataChannel,
  stage: HTMLElement,
  video: HTMLVideoElement,
  controlEnabled: () => boolean,
  onSessionState: (state: SessionState) => void,
): () => void {
  const held = new Set<"left" | "right" | "middle">();

  const send = (input: InputEvent): void => {
    if (!controlEnabled()) return;
    if (channel.readyState !== "open") return;
    channel.send(JSON.stringify(input));
  };

  const onControlMessage = (event: MessageEvent): void => {
    const json = parseJson(event.data);
    if (!json) return;
    const control = parseDataChannelControl(json);
    if (control?.type === "session-state") onSessionState(control);
  };

  const requestState = (): void => {
    if (channel.readyState !== "open") return;
    channel.send(serializeSessionSync());
  };

  let pendingMove: InputEvent | null = null;
  let moveScheduled = false;
  const queueMove = (input: InputEvent): void => {
    pendingMove = input;
    if (moveScheduled) return;
    moveScheduled = true;
    requestAnimationFrame(() => {
      moveScheduled = false;
      if (pendingMove) send(pendingMove);
      pendingMove = null;
    });
  };

  const onPointerDown = (event: PointerEvent): void => {
    const button = buttonName(event.button);
    if (!button) return;
    stage.focus();
    event.preventDefault();
    if (!controlEnabled()) return;
    const point = normalizedPoint(video, event.clientX, event.clientY);
    if (!point) return;
    held.add(button);
    // The click has to land on this pixel, so the move cannot wait for the next frame.
    pendingMove = null;
    send({ type: "mouse-move", x: point.x, y: point.y, normalized: true });
    send({ type: "mouse-button", button, action: "down" });
  };

  const onPointerMove = (event: PointerEvent): void => {
    queueMoveFromEvent(event, queueMove, video);
  };

  const onPointerUp = (event: PointerEvent): void => {
    const button = buttonName(event.button);
    if (!button || !held.has(button)) return;
    held.delete(button);
    send({ type: "mouse-button", button, action: "up" });
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    send({ type: "mouse-wheel", deltaX: event.deltaX, deltaY: event.deltaY });
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (!event.code || (event.type !== "keydown" && event.type !== "keyup")) return;
    event.preventDefault();
    send({ type: "key", code: event.code, action: event.type === "keydown" ? "down" : "up" });
  };

  const onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("keydown", onKey);
  stage.addEventListener("keyup", onKey);
  stage.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("pointerup", onPointerUp);
  channel.addEventListener("message", onControlMessage);
  channel.addEventListener("open", requestState);
  requestState();

  return () => {
    stage.removeEventListener("pointerdown", onPointerDown);
    stage.removeEventListener("pointermove", onPointerMove);
    stage.removeEventListener("wheel", onWheel);
    stage.removeEventListener("keydown", onKey);
    stage.removeEventListener("keyup", onKey);
    stage.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("pointerup", onPointerUp);
    channel.removeEventListener("message", onControlMessage);
    channel.removeEventListener("open", requestState);
    for (const button of held) send({ type: "mouse-button", button, action: "up" });
    held.clear();
  };
}

function parseJson(data: unknown): unknown {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

function queueMoveFromEvent(
  event: PointerEvent,
  queueMove: (input: InputEvent) => void,
  video: HTMLVideoElement,
): void {
  const point = normalizedPoint(video, event.clientX, event.clientY);
  if (!point) return;
  queueMove({ type: "mouse-move", x: point.x, y: point.y, normalized: true });
}

/**
 * Map a pointer into the video frame, not the element box.
 * `object-fit: contain` letterboxes the frame; clicks in the bars are ignored.
 */
function normalizedPoint(video: HTMLVideoElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const rect = video.getBoundingClientRect();
  const frameWidth = video.videoWidth;
  const frameHeight = video.videoHeight;
  if (!frameWidth || !frameHeight || rect.width === 0 || rect.height === 0) return null;
  const scale = Math.min(rect.width / frameWidth, rect.height / frameHeight);
  const width = frameWidth * scale;
  const height = frameHeight * scale;
  const left = rect.left + (rect.width - width) / 2;
  const top = rect.top + (rect.height - height) / 2;
  const x = (clientX - left) / width;
  const y = (clientY - top) / height;
  if (x < 0 || y < 0 || x > 1 || y > 1) return null;
  return { x, y };
}

function buttonName(button: number): "left" | "middle" | "right" | null {
  if (button === 0) return "left";
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return null;
}
