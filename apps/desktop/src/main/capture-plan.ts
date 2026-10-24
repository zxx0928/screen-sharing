import { desktopCapturer, screen, session } from "electron";
import type { CapturePlan } from "../shared/desktop-api";
import { chooseDisplayIndex, resolveCapturePlan } from "./capture-resolve";
import { getWin32Addon } from "./native-addon";

/**
 * Decide which capture backend the renderer should use.
 *
 * Windows loads `screen_sharing_win32` and returns `dxgi`. The main process
 * then duplicates the desktop with IDXGIOutputDuplication. The renderer is
 * sandboxed and never loads the `.node` addon.
 *
 * TODO(macos): ScreenCaptureKit belongs here too, behind `darwin`.
 */
export async function getCapturePlan(): Promise<CapturePlan> {
  const addon = getWin32Addon();
  let displayIndex = 0;
  if (addon) {
    try {
      displayIndex = chooseDisplayIndex(addon.getDesktopLayout().displays);
    } catch (error) {
      console.error("[capture] getDesktopLayout failed", error);
    }
  }
  const fallbackSourceId = process.platform === "win32" ? await primaryScreenSourceId() : null;
  const plan = resolveCapturePlan({
    platform: process.platform,
    nativeReady: addon !== null,
    displayIndex,
    fallbackSourceId,
  });
  if (plan.mode === "dxgi") console.log(`[capture] plan dxgi display ${plan.displayIndex}`);
  else console.log(`[capture] plan ${plan.mode}`);
  return plan;
}

/**
 * Satisfy `getDisplayMedia` without a picker by granting the first screen.
 * Used when the process is not on Windows, or when DXGI and the Electron
 * desktop source both fail.
 */
export function installDisplayMediaFallback(): void {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      })
      .then((sources) => {
        const source = sources[0];
        if (!source) {
          callback({});
          return;
        }
        callback({ video: source });
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

async function primaryScreenSourceId(): Promise<string | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 0, height: 0 },
    });
    const primaryId = String(screen.getPrimaryDisplay().id);
    const match = sources.find((source) => source.display_id === primaryId) ?? sources[0];
    return match?.id ?? null;
  } catch (error) {
    console.error("[capture] desktopCapturer failed", error);
    return null;
  }
}
