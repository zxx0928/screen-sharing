import type { WebContents } from "electron";
import { DXGI_MAX_FRAME_WIDTH } from "./frame-size";
import { describeCapturePipeline, summarizeH264Probe, type H264Probe } from "./h264-plan";
import { noteCaptureGeometry, setActiveDisplayIndex } from "./input-injection";
import { getWin32Addon, type NativeFrame } from "./native-addon";
import { IpcChannel } from "../shared/ipc";
import type { DxgiStartResult } from "../shared/desktop-api";

const PUMP_MS = 33;
const MAX_JPEG_BYTES = 8_000_000;

let owner: WebContents | null = null;
let timer: NodeJS.Timeout | null = null;

/**
 * DXGI capture pump. Frames are JPEG stills because a full Media Foundation
 * H.264 encoder is the next step (`describeCapturePipeline`). The renderer
 * paints the JPEG onto a canvas and lets Chromium encode the WebRTC track.
 */
export function startDxgiFor(webContents: WebContents, displayIndex: number): DxgiStartResult {
  const addon = getWin32Addon();
  if (!addon) return { ok: false, reason: "win32 addon is not loaded" };
  if (!Number.isInteger(displayIndex) || displayIndex < 0 || displayIndex > 64) {
    return { ok: false, reason: "display index is out of range" };
  }

  stopDxgiPump();
  let started: ReturnType<typeof addon.startCapture>;
  try {
    started = addon.startCapture(displayIndex, DXGI_MAX_FRAME_WIDTH);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "startCapture threw";
    console.error("[capture] DXGI start failed", error);
    return { ok: false, reason };
  }
  if (!started.ok) {
    console.error("[capture] DXGI start failed", started.error);
    return { ok: false, reason: started.error };
  }

  setActiveDisplayIndex(displayIndex);
  try {
    const layout = addon.getDesktopLayout();
    noteCaptureGeometry({
      capture: {
        originX: started.originX,
        originY: started.originY,
        width: started.captureWidth,
        height: started.captureHeight,
      },
      virtualScreen: layout.virtualScreen,
    });
  } catch (error) {
    console.error("[capture] desktop layout failed after DXGI start", error);
  }

  logH264(safeProbe(addon.probeH264.bind(addon)));
  const pipeline = describeCapturePipeline();
  console.log(
    `[capture] DXGI ${started.captureWidth}x${started.captureHeight} → jpeg ${started.frameWidth}x${started.frameHeight}; next encoder ${pipeline.next.encoder} ${pipeline.next.profile} ${pipeline.next.bitrate}bps`,
  );

  owner = webContents;
  let since = 0;
  timer = setInterval(() => {
    if (!owner || owner.isDestroyed()) {
      stopDxgiPump();
      return;
    }
    let frame: NativeFrame | null = null;
    try {
      frame = addon.acquireFrame(since);
    } catch (error) {
      console.error("[capture] acquireFrame failed", error);
      return;
    }
    if (!frame || frame.jpeg.length === 0 || frame.jpeg.length > MAX_JPEG_BYTES) return;
    since = frame.frameId;
    owner.send(IpcChannel.dxgiFrame, {
      frameId: frame.frameId,
      width: frame.width,
      height: frame.height,
      jpeg: frame.jpeg,
    });
  }, PUMP_MS);

  return {
    ok: true,
    displayIndex,
    originX: started.originX,
    originY: started.originY,
    captureWidth: started.captureWidth,
    captureHeight: started.captureHeight,
    frameWidth: started.frameWidth,
    frameHeight: started.frameHeight,
  };
}

/** Stops the pump when `webContents` owns it. Returns true if a pump stopped. */
export function stopDxgiFor(webContents: WebContents | null): boolean {
  if (webContents && owner && owner.id !== webContents.id) return false;
  const wasRunning = timer !== null || owner !== null;
  stopDxgiPump();
  return wasRunning;
}

export function stopAllDxgi(): void {
  stopDxgiPump();
}

function stopDxgiPump(): void {
  if (timer) clearInterval(timer);
  timer = null;
  owner = null;
  const addon = getWin32Addon();
  if (!addon) return;
  try {
    addon.stopCapture();
  } catch (error) {
    console.error("[capture] stopCapture failed", error);
  }
}

function safeProbe(probe: () => H264Probe): H264Probe {
  try {
    return probe();
  } catch (error) {
    const message = error instanceof Error ? error.message : "probe threw";
    return { available: false, error: message, encoders: [] };
  }
}

function logH264(probe: H264Probe): void {
  console.log(`[capture] ${summarizeH264Probe(probe)}`);
  for (const encoder of probe.encoders) {
    console.log(`[capture] h264 ${encoder.hardware ? "hardware" : "software"} ${encoder.name} ${encoder.clsid}`);
  }
}
