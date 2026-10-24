import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, clipboard, ipcMain } from "electron";
import { parseInputEvent } from "@screen-sharing/protocol";
import { getCapturePlan, installDisplayMediaFallback } from "./capture-plan";
import { startDxgiFor, stopAllDxgi, stopDxgiFor } from "./dxgi-host";
import { injectInput, releaseInjectedInput, setRemoteControlAllowed } from "./input-injection";
import { IpcChannel } from "../shared/ipc";

/**
 * Electron main process.
 *
 * One binary is both the controlled host and the controller. WebRTC runs in
 * the renderer because it needs a video element. This process owns the
 * window and the native modules that cannot live in the sandbox:
 * DXGI capture and SendInput injection (`native/win32`).
 *
 * Phase 1 does not take a single-instance lock. A second window on the same
 * machine is the easiest way to try a 1:1 session. You can also connect to
 * the device code shown in the same window; that loops the session locally.
 */

const DEFAULT_SIGNALING_URL = "ws://127.0.0.1:8787";

app.setName("屏幕共享");

app.whenReady().then(() => {
  installDisplayMediaFallback();
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  stopAllDxgi();
  releaseInjectedInput();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function registerIpc(): void {
  ipcMain.handle(IpcChannel.getConfig, () => ({
    signalingUrl: process.env.SIGNALING_URL || DEFAULT_SIGNALING_URL,
    platform: process.platform,
  }));

  ipcMain.handle(IpcChannel.getCapturePlan, () => getCapturePlan());

  ipcMain.handle(IpcChannel.startDxgi, (event, displayIndex: unknown) => {
    const index = typeof displayIndex === "number" ? displayIndex : 0;
    return startDxgiFor(event.sender, index);
  });

  ipcMain.on(IpcChannel.stopDxgi, (event) => {
    stopDxgiFor(event.sender);
  });

  ipcMain.handle(IpcChannel.copyText, (_event, text: unknown) => {
    if (typeof text !== "string" || text.length === 0 || text.length > 256) return false;
    clipboard.writeText(text);
    return true;
  });

  ipcMain.on(IpcChannel.injectInput, (_event, raw: unknown) => {
    const event = parseInputEvent(raw);
    if (!event) return;
    injectInput(event);
  });

  ipcMain.on(IpcChannel.setRemoteControl, (_event, allowed: unknown) => {
    setRemoteControlAllowed(allowed === true);
  });

  ipcMain.on(IpcChannel.endInputSession, () => {
    releaseInjectedInput();
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 880,
    minHeight: 640,
    show: false,
    title: "屏幕共享",
    backgroundColor: "#101418",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenu(null);
  win.on("close", () => {
    if (stopDxgiFor(win.webContents)) releaseInjectedInput();
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const pageFile = path.join(__dirname, "renderer", "index.html");
  // loadFile does not emit will-navigate. Block later in-page navigations.
  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  if (process.env.SCREEN_SHARING_DEV === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }

  const shotPath = process.env.SCREEN_SHARING_SHOT;
  if (shotPath) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        win.webContents
          .capturePage()
          .then((image) => {
            fs.writeFileSync(shotPath, image.toPNG());
            console.log(`[desktop] wrote screenshot ${shotPath}`);
          })
          .catch((error: unknown) => {
            console.error("[desktop] screenshot failed", error);
          });
      }, 700);
    });
  }

  win.webContents.once("did-finish-load", () => {
    console.log(`[desktop] window ready ${win.webContents.getURL()}`);
  });

  void win.loadFile(pageFile);
}
