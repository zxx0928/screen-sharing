import {
  formatDeviceCode,
  normalizeDeviceCode,
  normalizeTemporaryPassword,
  type ErrorCode,
  type ServerMessage,
} from "@screen-sharing/protocol";
import type { CaptureSource } from "./capture";
import { startControllerSession, startHostSession, type PeerSession } from "./peer-session";
import { SignalingClient, type SignalingStatus } from "./signaling-client";

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const ERROR_TEXT: Record<ErrorCode, string> = {
  "room-not-found": "找不到这台设备，请核对设备码。",
  "room-full": "对方正在被另一台设备控制。",
  "bad-password": "临时密码不正确。",
  "invalid-message": "信令消息无效。",
  "not-in-room": "当前不在房间内。",
  "already-in-room": "已经在一个房间里。",
  "not-host": "只有被控端可以修改临时密码。",
  "peer-not-ready": "对方还没有准备好。",
};

const CAPTURE_TEXT: Record<CaptureSource, string> = {
  "display-media": "采集：系统屏幕（getDisplayMedia，DXGI 尚未接入）",
  placeholder: "采集：占位画面。TODO(windows-dxgi) 接入后再替换。",
  "electron-desktop": "采集：Electron desktopCapturer",
  dxgi: "采集：DXGI",
};

const state = {
  signaling: "connecting" as SignalingStatus | "error",
  signalingUrl: "",
  hostCode: "",
  hostPeer: "offline" as "offline" | "waiting" | "connected",
  capture: "",
  live: false,
  sessionTitle: "正在连接",
  sessionDetail: "",
  hostError: "",
  hostTone: "error" as "error" | "ok",
  connectError: "",
};

const codeA = must<HTMLElement>("code-a");
const codeB = must<HTMLElement>("code-b");
const codeC = must<HTMLElement>("code-c");
const sigStatus = must<HTMLElement>("sig-status");
const hostPeer = must<HTMLElement>("host-peer");
const captureStatus = must<HTMLElement>("capture-status");
const hostError = must<HTMLElement>("host-error");
const copyCode = must<HTMLButtonElement>("copy-code");
const copyPassword = must<HTMLButtonElement>("copy-password");
const pwEnabled = must<HTMLInputElement>("pw-enabled");
const pwValue = must<HTMLInputElement>("pw-value");
const pwRegen = must<HTMLButtonElement>("pw-regen");
const pwApply = must<HTMLButtonElement>("pw-apply");
const connectForm = must<HTMLFormElement>("connect-form");
const remoteCode = must<HTMLInputElement>("remote-code");
const remotePassword = must<HTMLInputElement>("remote-password");
const connectError = must<HTMLElement>("connect-error");
const viewHome = must<HTMLElement>("view-home");
const viewRemote = must<HTMLElement>("view-remote");
const sessionTitle = must<HTMLElement>("session-title");
const sessionDetail = must<HTMLElement>("session-detail");
const hostBanner = must<HTMLElement>("host-banner");
const disconnectBtn = must<HTMLButtonElement>("disconnect-btn");
const stage = must<HTMLElement>("stage");
const video = must<HTMLVideoElement>("remote-video");
const stagePlaceholder = must<HTMLElement>("stage-placeholder");

let hostClient: SignalingClient | null = null;
let controllerClient: SignalingClient | null = null;
let hostPeerSession: PeerSession | null = null;
let controllerPeer: PeerSession | null = null;
let lastHostStatus: SignalingStatus | "error" = "connecting";

pwValue.value = generatePassword();

pwEnabled.addEventListener("change", () => {
  if (pwEnabled.checked && !pwValue.value.trim()) pwValue.value = generatePassword();
  if (state.hostCode) applyPassword();
  else render();
});
pwRegen.addEventListener("click", () => {
  pwEnabled.checked = true;
  pwValue.value = generatePassword();
  applyPassword();
});
pwApply.addEventListener("click", () => applyPassword());
copyCode.addEventListener("click", () => {
  if (state.hostCode) void copyText(formatDeviceCode(state.hostCode), copyCode, "复制设备码");
});
copyPassword.addEventListener("click", () => {
  const password = readHostPassword();
  if (password) void copyText(password, copyPassword, "复制");
});
connectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  connectToDevice();
});
disconnectBtn.addEventListener("click", () => {
  stopController();
  state.live = false;
  state.connectError = "";
  stagePlaceholder.hidden = false;
  render();
});
video.addEventListener("loadedmetadata", () => {
  stagePlaceholder.hidden = video.videoWidth > 0;
});

void boot();
render();

async function boot(): Promise<void> {
  try {
    const config = await window.desktop.getConfig();
    state.signalingUrl = config.signalingUrl;
  } catch (error) {
    console.error(error);
    state.signaling = "error";
    state.hostError = "读不到桌面配置。";
    render();
    return;
  }

  hostClient = new SignalingClient(state.signalingUrl, {
    reconnect: true,
    onStatus: (status) => {
      const becameOpen = status === "open" && lastHostStatus !== "open";
      lastHostStatus = status;
      state.signaling = status;
      if (status === "closed") {
        stopHostPeer();
        state.hostCode = "";
        state.hostPeer = "offline";
        state.capture = "";
        window.desktop.endInputSession();
      }
      if (becameOpen) sendCreateRoom();
      render();
    },
    onMessage: (message) => {
      if (message.type === "room-created") {
        state.hostCode = message.code;
        state.hostPeer = "waiting";
        render();
        return;
      }
      handleHostMessage(message);
    },
  });
  hostClient.connect();
}

function handleHostMessage(message: ServerMessage): void {
  switch (message.type) {
    case "peer-joined":
      stopHostPeer();
      state.hostPeer = "connected";
      state.capture = "正在采集画面…";
      hostPeerSession = startHostSession({
        sendSignal: (payload) => hostClient?.send({ type: "signal", payload }),
        onCaptureSource: (source) => {
          state.capture = CAPTURE_TEXT[source];
          render();
        },
        onError: (error) => {
          console.error("[host] session failed", error);
          state.capture = "采集或协商失败，房间仍在。";
          render();
        },
      });
      render();
      return;
    case "peer-left":
      stopHostPeer();
      window.desktop.endInputSession();
      state.hostPeer = state.hostCode ? "waiting" : "offline";
      state.capture = "";
      render();
      return;
    case "signal":
      if (message.from !== "controller") return;
      void hostPeerSession?.acceptSignal(message.payload);
      return;
    case "password-updated":
      state.hostTone = "ok";
      state.hostError = message.enabled ? "临时密码已更新。" : "已关闭临时密码。";
      render();
      return;
    case "error":
      state.hostTone = "error";
      state.hostError = ERROR_TEXT[message.code];
      render();
      return;
    default:
      return;
  }
}

function sendCreateRoom(): void {
  const password = readHostPassword();
  if (password === null) {
    state.hostTone = "error";
    state.hostError = "临时密码无效，已用无密码方式创建房间。";
    hostClient?.send({ type: "create-room" });
    return;
  }
  state.hostError = "";
  hostClient?.send(password ? { type: "create-room", password } : { type: "create-room" });
}

function applyPassword(): void {
  const password = readHostPassword();
  if (password === null) {
    state.hostTone = "error";
    state.hostError = "临时密码不能包含控制字符，最长 64 位。";
    render();
    return;
  }
  if (!state.hostCode) {
    state.hostTone = "error";
    state.hostError = "房间还没创建，连上信令后会使用这个密码。";
    render();
    return;
  }
  state.hostError = "";
  hostClient?.send(password ? { type: "set-password", password } : { type: "set-password" });
  render();
}

function connectToDevice(): void {
  const code = normalizeDeviceCode(remoteCode.value);
  if (!code) {
    state.connectError = "请输入 9 位设备码。";
    render();
    return;
  }
  const typedPassword = remotePassword.value.trim();
  const password = typedPassword ? normalizeTemporaryPassword(typedPassword) : undefined;
  if (password === null) {
    state.connectError = "临时密码无效。";
    render();
    return;
  }
  if (!state.signalingUrl) {
    state.connectError = "信令地址还没准备好。";
    render();
    return;
  }

  stopController();
  state.live = true;
  state.connectError = "";
  state.sessionTitle = "正在加入…";
  state.sessionDetail = formatDeviceCode(code);
  stagePlaceholder.hidden = false;
  render();

  const client = new SignalingClient(state.signalingUrl, {
    reconnect: false,
    onStatus: (status) => {
      if (controllerClient !== client) return;
      if (status === "open") {
        client.send(password ? { type: "join-room", code, password } : { type: "join-room", code });
      }
      if (status === "closed" && state.live) failController("信令连接已断开。");
    },
    onMessage: (message) => {
      if (controllerClient !== client) return;
      handleControllerMessage(message);
    },
  });
  controllerClient = client;
  client.connect();
}

function handleControllerMessage(message: ServerMessage): void {
  switch (message.type) {
    case "joined":
      state.sessionTitle = "正在协商";
      state.sessionDetail = formatDeviceCode(message.code);
      controllerPeer = startControllerSession({
        stage,
        video,
        sendSignal: (payload) => controllerClient?.send({ type: "signal", payload }),
        onConnectionState: (connection) => {
          state.sessionTitle = connectionLabel(connection);
          if (connection === "connected") stage.focus();
          render();
        },
      });
      render();
      return;
    case "signal":
      if (message.from !== "host") return;
      void controllerPeer?.acceptSignal(message.payload);
      return;
    case "peer-left":
      failController("对方已结束会话。");
      return;
    case "error":
      failController(ERROR_TEXT[message.code]);
      return;
    default:
      return;
  }
}

function failController(text: string): void {
  stopController();
  state.live = false;
  state.connectError = text;
  stagePlaceholder.hidden = false;
  render();
}

function stopHostPeer(): void {
  hostPeerSession?.stop();
  hostPeerSession = null;
}

function stopController(): void {
  const client = controllerClient;
  controllerClient = null;
  controllerPeer?.stop();
  controllerPeer = null;
  client?.send({ type: "leave" });
  client?.close();
  video.srcObject = null;
}

function readHostPassword(): string | undefined | null {
  if (!pwEnabled.checked) return undefined;
  return normalizeTemporaryPassword(pwValue.value);
}

function render(): void {
  sigStatus.className = `status ${state.signaling === "error" ? "closed" : state.signaling}`;
  sigStatus.textContent = signalingLabel();

  if (state.hostCode) {
    const [a, b, c] = formatDeviceCode(state.hostCode).split(" ");
    codeA.textContent = a ?? "———";
    codeB.textContent = b ?? "———";
    codeC.textContent = c ?? "———";
  } else {
    codeA.textContent = "———";
    codeB.textContent = "———";
    codeC.textContent = "———";
  }
  copyCode.disabled = !state.hostCode;
  hostPeer.textContent =
    state.hostPeer === "connected" ? "控制端已连接" : state.hostPeer === "waiting" ? "等待控制端连接" : "信令未就绪";
  captureStatus.textContent = state.capture;
  hostError.hidden = !state.hostError;
  hostError.className = state.hostTone === "ok" ? "note" : "error";
  hostError.textContent = state.hostError;
  pwValue.disabled = !pwEnabled.checked;
  copyPassword.disabled = !pwEnabled.checked || !pwValue.value.trim();

  connectError.hidden = !state.connectError;
  connectError.textContent = state.connectError;
  viewHome.hidden = state.live;
  viewRemote.hidden = !state.live;
  sessionTitle.textContent = state.sessionTitle;
  sessionDetail.textContent = state.sessionDetail;
  hostBanner.hidden = !(state.live && state.hostPeer === "connected");
}

function signalingLabel(): string {
  if (state.signaling === "open") return `信令已连接 ${state.signalingUrl}`;
  if (state.signaling === "connecting") return "正在连接信令…";
  if (state.signaling === "error") return "桌面配置不可用";
  return "信令未连接，正在重试…";
}

function connectionLabel(connection: RTCPeerConnectionState): string {
  switch (connection) {
    case "connected":
      return "已连接";
    case "connecting":
      return "正在连接媒体…";
    case "disconnected":
      return "媒体断开";
    case "failed":
      return "媒体失败";
    case "closed":
      return "已关闭";
    default:
      return "正在协商";
  }
}

async function copyText(text: string, button: HTMLButtonElement, restore: string): Promise<void> {
  const ok = await window.desktop.copyText(text);
  button.textContent = ok ? "已复制" : "复制失败";
  setTimeout(() => {
    button.textContent = restore;
  }, 1200);
}

function generatePassword(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length] ?? "A").join("");
}

function must<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}
