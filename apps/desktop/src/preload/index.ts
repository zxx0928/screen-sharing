import { contextBridge, ipcRenderer } from "electron";
import type { InputEvent } from "@screen-sharing/protocol";
import type { DesktopApi } from "../shared/desktop-api";
import { IpcChannel } from "../shared/ipc";

const api: DesktopApi = {
  getConfig: () => ipcRenderer.invoke(IpcChannel.getConfig),
  getCapturePlan: () => ipcRenderer.invoke(IpcChannel.getCapturePlan),
  injectInput: (event: InputEvent) => {
    ipcRenderer.send(IpcChannel.injectInput, event);
  },
  endInputSession: () => {
    ipcRenderer.send(IpcChannel.endInputSession);
  },
  copyText: (text: string) => ipcRenderer.invoke(IpcChannel.copyText, text),
};

contextBridge.exposeInMainWorld("desktop", api);
