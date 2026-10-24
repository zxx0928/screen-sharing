import type { CapturePlan } from "../shared/desktop-api";

export type CaptureSource = "display-media" | "placeholder" | "electron-desktop" | "dxgi";

/**
 * Outbound screen track for the host role.
 *
 * Called only after a controller joins — do not capture at app launch.
 * Failures fall through to a canvas placeholder so signaling and the
 * DataChannel can still be exercised without a real display.
 */
export async function acquireScreenTrack(plan: CapturePlan): Promise<{ track: MediaStreamTrack; source: CaptureSource }> {
  if (plan.mode === "dxgi") {
    // TODO(windows-dxgi): the main process owns the native DXGI pump.
    // Wire its frames into a MediaStreamTrack here, then return
    // { source: "dxgi" }. Until that addon exists, send a placeholder.
    console.warn("[capture] DXGI native module is not linked; using placeholder track");
    return { track: createPlaceholderTrack(), source: "placeholder" };
  }

  if (plan.mode === "electron-desktop") {
    const track = await captureElectronDesktop(plan.sourceId);
    if (track) return { track, source: "electron-desktop" };
  }

  if (plan.mode === "display-media" || plan.mode === "electron-desktop") {
    const track = await captureDisplayMedia();
    if (track) return { track, source: "display-media" };
  }

  if (plan.mode === "placeholder") {
    console.warn(`[capture] placeholder requested (${plan.reason})`);
  }
  return { track: createPlaceholderTrack(), source: "placeholder" };
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
  // TODO(encode): once DXGI lands, set RTCRtpSender encodings
  // (maxBitrate, maxFramerate, scaleResolutionDownBy). Phase 1 uses defaults.
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
    ctx.fillText("TODO(windows-dxgi): replace with DXGI Desktop Duplication", 72, 380);
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
