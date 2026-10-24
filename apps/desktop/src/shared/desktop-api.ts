import type { InputEvent } from "@screen-sharing/protocol";

/**
 * How the host should produce the outbound screen track.
 * Phase 1 always uses `display-media` (with a canvas placeholder fallback).
 * The other modes are the extension points for the capture teammate.
 */
export type CapturePlan =
  | { mode: "display-media" }
  | { mode: "placeholder"; reason: string }
  | { mode: "electron-desktop"; sourceId: string }
  | { mode: "dxgi" };

export type DesktopConfig = {
  /** WebSocket URL of the self-hosted signaling server. */
  signalingUrl: string;
  /** `process.platform` of this Electron main process (`win32` first). */
  platform: string;
};

export type DesktopApi = {
  getConfig(): Promise<DesktopConfig>;
  getCapturePlan(): Promise<CapturePlan>;
  /**
   * Host only. Forwards one controller input event from the DataChannel
   * into the main process, where injection will live.
   */
  injectInput(event: InputEvent): void;
  /** Host only. The remote session ended; release keys held by the stub. */
  endInputSession(): void;
  copyText(text: string): Promise<boolean>;
};

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}
