import type { InputEvent } from "@screen-sharing/protocol";
import type { IceServer, IceTransportPolicy } from "./ice-config";

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
      transport: "h264" | "jpeg";
      encoderName: string;
    }
  | { ok: false; reason: string };

/**
 * One frame from the main-process DXGI pump.
 * `h264` is Annex-B. `jpeg` is the WIC fallback. A frame carries one of them.
 */
export type DxgiFrame = {
  frameId: number;
  width: number;
  height: number;
  keyframe?: boolean;
  jpeg?: Uint8Array;
  h264?: Uint8Array;
};

export type DesktopConfig = {
  /** WebSocket URL of the self-hosted signaling server. */
  signalingUrl: string;
  /** `process.platform` of this Electron main process (`win32` first). */
  platform: string;
  /**
   * STUN/TURN servers for the WebRTC session.
   * TURN credentials come from the environment on this machine, not from the repo.
   */
  iceServers: IceServer[];
  /** `relay` forces TURN. `all` allows host, server-reflexive, and relay candidates. */
  iceTransportPolicy: IceTransportPolicy;
};

export type DesktopApi = {
  getConfig(): Promise<DesktopConfig>;
  getCapturePlan(): Promise<CapturePlan>;
  /**
   * Host only. Start DXGI duplication and stream H.264 or JPEG frames to this window.
   * The native addon stays in the main process.
   */
  startDxgiCapture(displayIndex: number): Promise<DxgiStartResult>;
  stopDxgiCapture(): void;
  onDxgiFrame(listener: (frame: DxgiFrame) => void): () => void;
  /**
   * Host only. Forwards one controller input event from the DataChannel
   * into the main process, which calls SendInput on Windows when remote
   * control is allowed.
   */
  injectInput(event: InputEvent): void;
  /**
   * Host only. `false` (the default) drops input before SendInput and
   * releases keys this session is holding. `true` allows injection.
   */
  setRemoteControl(allowed: boolean): void;
  /** Host only. The remote session ended; release keys this session pressed. */
  endInputSession(): void;
  copyText(text: string): Promise<boolean>;
};

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}
