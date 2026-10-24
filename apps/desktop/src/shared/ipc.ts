/** IPC channel names shared by the main process and the preload bridge. */
export const IpcChannel = {
  getConfig: "app:get-config",
  copyText: "app:copy-text",
  getCapturePlan: "capture:get-plan",
  startDxgi: "capture:dxgi-start",
  stopDxgi: "capture:dxgi-stop",
  dxgiFrame: "capture:dxgi-frame",
  injectInput: "input:inject",
  setRemoteControl: "input:set-control",
  endInputSession: "input:session-end",
} as const;
