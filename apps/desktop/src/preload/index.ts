import { contextBridge, ipcRenderer } from "electron";
import type { InputEvent } from "@screen-sharing/protocol";
import type { DesktopApi, DxgiFrame } from "../shared/desktop-api";
import { IpcChannel } from "../shared/ipc";

const api: DesktopApi = {
  getConfig: () => ipcRenderer.invoke(IpcChannel.getConfig),
  getCapturePlan: () => ipcRenderer.invoke(IpcChannel.getCapturePlan),
  startDxgiCapture: (displayIndex: number) => ipcRenderer.invoke(IpcChannel.startDxgi, displayIndex),
  stopDxgiCapture: () => {
    ipcRenderer.send(IpcChannel.stopDxgi);
  },
  onDxgiFrame: (listener: (frame: DxgiFrame) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: DxgiFrame) => {
      listener(payload);
    };
    ipcRenderer.on(IpcChannel.dxgiFrame, wrapped);
    return () => {
      ipcRenderer.removeListener(IpcChannel.dxgiFrame, wrapped);
    };
  },
  injectInput: (event: InputEvent) => {
    ipcRenderer.send(IpcChannel.injectInput, event);
  },
  setRemoteControl: (allowed: boolean) => {
    ipcRenderer.send(IpcChannel.setRemoteControl, allowed);
  },
  endInputSession: () => {
    ipcRenderer.send(IpcChannel.endInputSession);
  },
  copyText: (text: string) => ipcRenderer.invoke(IpcChannel.copyText, text),
};

contextBridge.exposeInMainWorld("desktop", api);
