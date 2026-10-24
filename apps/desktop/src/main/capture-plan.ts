import { desktopCapturer, session } from "electron";
import type { CapturePlan } from "../shared/desktop-api";

/**
 * Decide which capture backend the renderer should use.
 *
 * TODO(windows-dxgi): when `process.platform === "win32"` and the native
 * addon is linked, return `{ mode: "dxgi" }` and start a DXGI Desktop
 * Duplication pump in this main process. The renderer is sandboxed and
 * must not load that `.node` addon. Frames still need to become a
 * MediaStreamTrack the WebRTC sender can add — either by handing the
 * renderer an Electron desktop source id, or by a later custom video
 * source. Do not encode in the renderer.
 *
 * TODO(macos): ScreenCaptureKit belongs here too, behind `darwin`.
 * Not part of Phase 1.
 */
export function getCapturePlan(): CapturePlan {
  return { mode: "display-media" };
}

/**
 * Satisfy `getDisplayMedia` without a picker by granting the first screen.
 * This is the stock Electron capture path and only a stand-in for DXGI.
 */
export function installDisplayMediaFallback(): void {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      })
      .then((sources) => {
        const screen = sources[0];
        if (!screen) {
          callback({});
          return;
        }
        // TODO(windows-dxgi): replace `screen` with the native capture track.
        callback({ video: screen });
      })
      .catch((error: unknown) => {
        console.error("[capture] desktopCapturer failed", error);
        callback({});
      });
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media" || permission === "display-capture");
  });
}
