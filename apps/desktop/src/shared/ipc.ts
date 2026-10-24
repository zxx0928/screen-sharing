/** IPC channel names shared by the main process and the preload bridge. */
export const IpcChannel = {
  getConfig: "app:get-config",
  copyText: "app:copy-text",
  getCapturePlan: "capture:get-plan",
  injectInput: "input:inject",
  endInputSession: "input:session-end",
} as const;
