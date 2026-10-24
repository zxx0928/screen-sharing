import type { InputEvent } from "@screen-sharing/protocol";

/**
 * How the host should produce the outbound screen track.
 * `dxgi` is the Windows native Desktop Duplication path.
 * `electron-desktop` is Chromium's capturer, used when the addon is not built.
 */
export type CapturePlan =
  | { mode: "display-media" }
  | { mode: "placeholder"; reason: string }
  | { mode: "electron-desktop"; sourceId: string }
  | { mode: "dxgi"; displayIndex: number; fallbackSourceId: string | null };

export type DxgiStartResult =
  | {
      ok: true;
      displayIndex: number;
      originX: number;
      originY: number;
      captureWidth: number;
      captureHeight: number;
      frameWidth: number;
      frameHeight: number;
    }
  | { ok: false; reason: string };

/** One JPEG preview frame from the main-process DXGI pump. */
export type DxgiFrame = {
  frameId: number;
  width: number;
  height: number;
  jpeg: Uint8Array;
};

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
   * Host only. Start DXGI duplication and stream JPEG frames to this window.
   * The native addon stays in the main process.
   */
  startDxgiCapture(displayIndex: number): Promise<DxgiStartResult>;
  stopDxgiCapture(): void;
  onDxgiFrame(listener: (frame: DxgiFrame) => void): () => void;
  /**
   * Host only. Forwards one controller input event from the DataChannel
   * into the main process, which calls SendInput on Windows.
   */
  injectInput(event: InputEvent): void;
  /** Host only. The remote session ended; release keys this session pressed. */
  endInputSession(): void;
  copyText(text: string): Promise<boolean>;
};

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}
