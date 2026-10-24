import type { CapturePlan, DesktopApi, DxgiFrame } from "../shared/desktop-api";
import { createH264Preview, type H264Preview } from "./h264-preview";

export type CaptureSource = "display-media" | "placeholder" | "electron-desktop" | "dxgi" | "dxgi-h264";

/**
 * Outbound screen track for the host role.
 *
 * Called only after a controller joins — do not capture at app launch.
 * Failures fall through to a canvas placeholder so signaling and the
 * DataChannel can still be exercised without a real display.
 */
export async function acquireScreenTrack(plan: CapturePlan): Promise<{ track: MediaStreamTrack; source: CaptureSource }> {
  if (plan.mode === "dxgi") {
    const captured = await captureDxgi(plan.displayIndex);
    if (captured) return captured;
    console.warn("[capture] DXGI pump failed; trying the Electron desktop source");
    if (plan.fallbackSourceId) {
      const fallback = await captureElectronDesktop(plan.fallbackSourceId);
      if (fallback) return { track: fallback, source: "electron-desktop" };
    }
  }

  if (plan.mode === "electron-desktop") {
    const track = await captureElectronDesktop(plan.sourceId);
    if (track) return { track, source: "electron-desktop" };
  }

  if (plan.mode === "display-media" || plan.mode === "electron-desktop" || plan.mode === "dxgi") {
    const track = await captureDisplayMedia();
    if (track) return { track, source: "display-media" };
  }

  if (plan.mode === "placeholder") {
    console.warn(`[capture] placeholder requested (${plan.reason})`);
  }
  return { track: createPlaceholderTrack(), source: "placeholder" };
}

async function captureDxgi(displayIndex: number): Promise<{ track: MediaStreamTrack; source: "dxgi" | "dxgi-h264" } | null> {
  let started: Awaited<ReturnType<DesktopApi["startDxgiCapture"]>>;
  try {
    started = await window.desktop.startDxgiCapture(displayIndex);
  } catch (error) {
    console.warn("[capture] startDxgiCapture failed", error);
    return null;
  }
  if (!started.ok) {
    console.warn("[capture] DXGI did not start", started.reason);
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, started.frameWidth);
  canvas.height = Math.max(2, started.frameHeight);
  // captureStream skips canvases with display:none. Park this one offscreen.
  canvas.className = "dxgi-frame";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    window.desktop.stopDxgiCapture();
    return null;
  }
  paintWaiting(ctx, canvas.width, canvas.height);

  const stream = canvas.captureStream(30);
  const track = stream.getVideoTracks()[0];
  if (!track) {
    canvas.remove();
    window.desktop.stopDxgiCapture();
    return null;
  }
  const requester = track as MediaStreamTrack & { requestFrame?: () => void };
  const requestFrame = typeof requester.requestFrame === "function" ? () => requester.requestFrame?.() : null;
  requestFrame?.();

  let drawing = false;
  let pending: DxgiFrame | null = null;
  const preview: H264Preview = createH264Preview(canvas, ctx, requestFrame);
  const drawNext = (): void => {
    const frame = pending;
    pending = null;
    if (!frame?.jpeg || frame.jpeg.byteLength === 0) {
      drawing = false;
      return;
    }
    drawing = true;
    const bytes = new Uint8Array(frame.jpeg);
    createImageBitmap(new Blob([bytes], { type: "image/jpeg" }))
      .then((bitmap) => {
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        requestFrame?.();
        if (pending) drawNext();
        else drawing = false;
      })
      .catch(() => {
        drawing = false;
      });
  };

  const unsubscribe = window.desktop.onDxgiFrame((frame) => {
    // Deltas cannot be dropped. JPEG can keep only the newest still.
    if (frame.h264 && frame.h264.byteLength > 0) {
      preview.push(new Uint8Array(frame.h264), Boolean(frame.keyframe));
      return;
    }
    pending = frame;
    if (!drawing) drawNext();
  });

  let stopped = false;
  const stop = track.stop.bind(track);
  const release = (): void => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    preview.close();
    canvas.remove();
    window.desktop.stopDxgiCapture();
  };
  track.stop = () => {
    release();
    stop();
  };
  track.addEventListener("ended", release);
  const decorated = decorate(track);
  if (!decorated) {
    release();
    return null;
  }
  return { track: decorated, source: started.transport === "h264" ? "dxgi-h264" : "dxgi" };
}

function paintWaiting(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = "#101418";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#6dceb4";
  ctx.fillRect(0, 0, width, 8);
  ctx.fillStyle = "#e7eeea";
  ctx.font = "600 36px sans-serif";
  ctx.fillText("DXGI 正在采集…", 48, Math.max(80, height / 2));
}

async function captureElectronDesktop(sourceId: string): Promise<MediaStreamTrack | null> {
  try {
    // Electron-only constraint. The DOM lib does not know chromeMediaSource.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
        },
      },
    } as MediaStreamConstraints);
    return decorate(stream.getVideoTracks()[0]);
  } catch (error) {
    console.warn("[capture] electron desktop source failed", error);
    return null;
  }
}

async function captureDisplayMedia(): Promise<MediaStreamTrack | null> {
  if (!navigator.mediaDevices?.getDisplayMedia) return null;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
    });
    return decorate(stream.getVideoTracks()[0]);
  } catch (error) {
    console.warn("[capture] getDisplayMedia failed; using placeholder track", error);
    return null;
  }
}

function decorate(track: MediaStreamTrack | undefined): MediaStreamTrack | null {
  if (!track) return null;
  // "text" hints the browser encoder to prefer sharp UI over motion blur.
  track.contentHint = "text";
  return track;
}

function createPlaceholderTrack(): MediaStreamTrack {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  let frame = 0;
  const draw = (): void => {
    ctx.fillStyle = "#122033";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#6dceb4";
    ctx.fillRect(0, 0, canvas.width, 8);
    ctx.fillStyle = "#e7eeea";
    ctx.font = "600 42px sans-serif";
    ctx.fillText("屏幕共享占位画面", 72, 320);
    ctx.font = "24px sans-serif";
    ctx.fillStyle = "#93a8b3";
    ctx.fillText("没有拿到屏幕画面", 72, 380);
    ctx.fillText(`placeholder frame ${frame}`, 72, 430);
    frame += 1;
  };
  draw();

  const timer = setInterval(draw, 250);
  const stream = canvas.captureStream(4);
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("Placeholder stream has no video track");
  const stop = track.stop.bind(track);
  track.stop = () => {
    clearInterval(timer);
    stop();
  };
  track.addEventListener("ended", () => clearInterval(timer));
  return track;
}
