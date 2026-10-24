import {
  DEFAULT_REMOTE_CONTROL_ENABLED,
  DEFAULT_SHARING_ENABLED,
  formatDeviceCode,
  normalizeTemporaryPassword,
  type ErrorCode,
  type ServerMessage,
  type SessionState,
} from "@screen-sharing/protocol";
import type { CaptureSource } from "./capture";
import { parseConnectInput } from "./connect-input";
import { startControllerSession, startHostSession, type HostPeerSession, type PeerSession } from "./peer-session";
import { SignalingClient, type SignalingStatus } from "./signaling-client";

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const HISTORY_KEY = "xiaoxu-connect.history.v1";
const REJECT_NOTICE = "已拒绝。正在换一个临时连接码。";
/** Confirm ICE `disconnected` before tearing the view down, so a one-packet blip can recover. */
const CONTROLLER_DISCONNECT_GRACE_MS = 1000;

const ERROR_TEXT: Record<ErrorCode, string> = {
  "room-not-found": "找不到这台设备，请核对设备码。",
  "room-full": "对方正在被另一台设备控制。",
  "bad-password": "安全连接码不正确。",
  "invalid-message": "信令消息无效。",
  "not-in-room": "当前不在房间内。",
  "already-in-room": "已经在一个房间里。",
  "not-host": "只有被控端可以修改安全连接码。",
  "peer-not-ready": "对方还没有准备好。",
};

const CAPTURE_TEXT: Record<CaptureSource, string> = {
  "display-media": "采集：getDisplayMedia",
  placeholder: "采集：占位画面（当前没有屏幕轨）",
  "electron-desktop": "采集：Electron desktopCapturer（Chromium DXGI）",
  dxgi: "采集：DXGI Desktop Duplication",
  "dxgi-h264": "采集：DXGI Desktop Duplication（H.264）",
};

type Nav = "device" | "devices" | "history";
type ControllerPhase = "idle" | "connecting" | "live" | "ended";
type HistoryItem = { id: string; title: string; at: number; code?: string };

const state = {
  signaling: "connecting" as SignalingStatus | "error",
  signalingUrl: "",
  iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }] as RTCIceServer[],
  iceTransportPolicy: "all" as RTCIceTransportPolicy,
  hostCode: "",
  hostPeer: "offline" as "offline" | "waiting" | "connected",
  capture: "",
  hostError: "",
  hostTone: "error" as "error" | "ok",
  connectError: "",
  sharing: DEFAULT_SHARING_ENABLED,
  control: DEFAULT_REMOTE_CONTROL_ENABLED,
  remoteSharing: DEFAULT_SHARING_ENABLED,
  remoteControl: DEFAULT_REMOTE_CONTROL_ENABLED,
  nav: "device" as Nav,
  controllerPhase: "idle" as ControllerPhase,
  auth: false,
  accepted: false,
  password: "",
  passwordEnabled: true,
  secureShown: false,
  editingPassword: false,
  localMouse: true,
  localKeyboard: true,
  qualityOpen: false,
  lastRemoteCode: "",
  sessionRecorded: false,
  history: [] as HistoryItem[],
};

const presenceDot = must<HTMLElement>("presence-dot");
const presence = must<HTMLElement>("presence");
const profile = must<HTMLButtonElement>("profile");
const profileMenu = must<HTMLElement>("profile-menu");
const sigLine = must<HTMLElement>("sig-line");
const navButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-nav]"));
const deviceCode = must<HTMLElement>("device-code");
const copyCode = must<HTMLButtonElement>("copy-code");
const codeRotate = must<HTMLButtonElement>("code-rotate");
const secureCode = must<HTMLElement>("secure-code");
const pwEditor = must<HTMLElement>("pw-editor");
const pwValue = must<HTMLInputElement>("pw-value");
const pwRegen = must<HTMLButtonElement>("pw-regen");
const pwApply = must<HTMLButtonElement>("pw-apply");
const secureReveal = must<HTMLButtonElement>("secure-reveal");
const pwEdit = must<HTMLButtonElement>("pw-edit");
const hostError = must<HTMLElement>("host-error");
const connectForm = must<HTMLFormElement>("connect-form");
const remoteCode = must<HTMLInputElement>("remote-code");
const connectError = must<HTMLElement>("connect-error");
const viewDevice = must<HTMLElement>("view-device");
const viewDevices = must<HTMLElement>("view-devices");
const viewHistory = must<HTMLElement>("view-history");
const historyEmpty = must<HTMLElement>("history-empty");
const historyList = must<HTMLElement>("history-list");
const viewConnecting = must<HTMLElement>("view-connecting");
const cancelConnect = must<HTMLButtonElement>("cancel-connect");
const viewDisconnected = must<HTMLElement>("view-disconnected");
const backHome = must<HTMLButtonElement>("back-home");
const viewHistoryBtn = must<HTMLButtonElement>("view-history-btn");
const shell = must<HTMLElement>("shell");
const authModal = must<HTMLElement>("auth-modal");
const authYes = must<HTMLButtonElement>("auth-yes");
const authLook = must<HTMLButtonElement>("auth-look");
const authLater = must<HTMLButtonElement>("auth-later");
const viewGuest = must<HTMLElement>("view-guest");
const guestDisconnect = must<HTMLButtonElement>("guest-disconnect");
const shareToggle = must<HTMLButtonElement>("share-toggle");
const controlEnabled = must<HTMLInputElement>("control-enabled");
const captureStatus = must<HTMLElement>("capture-status");
const viewController = must<HTMLElement>("view-controller");
const sessionTitle = must<HTMLElement>("session-title");
const sessionHostControls = must<HTMLElement>("session-host-controls");
const sessionShareToggle = must<HTMLButtonElement>("session-share-toggle");
const sessionControlEnabled = must<HTMLInputElement>("session-control-enabled");
const sessionCapture = must<HTMLElement>("session-capture");
const disconnectBtn = must<HTMLButtonElement>("disconnect-btn");
const stage = must<HTMLElement>("stage");
const video = must<HTMLVideoElement>("remote-video");
const stagePlaceholder = must<HTMLElement>("stage-placeholder");
const toolMouse = must<HTMLButtonElement>("tool-mouse");
const toolKeyboard = must<HTMLButtonElement>("tool-keyboard");
const toolFullscreen = must<HTMLButtonElement>("tool-fullscreen");
const toolQuality = must<HTMLButtonElement>("tool-quality");
const qualityPop = must<HTMLElement>("quality-pop");

let hostClient: SignalingClient | null = null;
let controllerClient: SignalingClient | null = null;
let hostPeerSession: HostPeerSession | null = null;
let controllerPeer: PeerSession | null = null;
let lastHostStatus: SignalingStatus | "error" = "connecting";
let controllerGen = 0;
let hostNoticeTimer: ReturnType<typeof setTimeout> | null = null;
let controllerDisconnectTimer: ReturnType<typeof setTimeout> | null = null;

state.history = loadHistory();
state.password = generatePassword();
pwValue.value = state.password;

copyCode.addEventListener("click", () => {
  if (!state.hostCode) return;
  void copyText(formatDeviceCode(state.hostCode), copyCode, "复制");
});
codeRotate.addEventListener("click", () => rotateDeviceCode());
secureReveal.addEventListener("click", () => {
  if (!state.passwordEnabled) return;
  state.secureShown = !state.secureShown;
  render();
});
pwEdit.addEventListener("click", () => {
  state.editingPassword = !state.editingPassword;
  if (state.editingPassword) pwValue.value = state.passwordEnabled ? state.password : "";
  else pwValue.value = state.password;
  render();
  if (state.editingPassword) pwValue.focus();
});
pwRegen.addEventListener("click", () => {
  pwValue.value = generatePassword();
  pwValue.focus();
});
pwApply.addEventListener("click", () => commitPasswordFromEditor());
pwValue.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  commitPasswordFromEditor();
});
connectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  connectToDevice();
});
cancelConnect.addEventListener("click", () => cancelController());
disconnectBtn.addEventListener("click", () => {
  const ended = state.controllerPhase === "live";
  if (ended) noteHistory("controller");
  stopController();
  state.connectError = "";
  resetRemotePolicy();
  state.localMouse = true;
  state.localKeyboard = true;
  state.controllerPhase = ended ? "ended" : "idle";
  stagePlaceholder.hidden = false;
  stagePlaceholder.textContent = "等待对方画面…";
  render();
});
guestDisconnect.addEventListener("click", () => disconnectGuest());
backHome.addEventListener("click", () => {
  state.controllerPhase = "idle";
  state.nav = "device";
  render();
});
viewHistoryBtn.addEventListener("click", () => {
  state.controllerPhase = "idle";
  state.nav = "history";
  render();
});
authYes.addEventListener("click", () => acceptIncoming(true));
authLook.addEventListener("click", () => acceptIncoming(false));
authLater.addEventListener("click", () => rejectIncoming());
shareToggle.addEventListener("click", () => toggleSharing());
sessionShareToggle.addEventListener("click", () => toggleSharing());
controlEnabled.addEventListener("change", (event) => onControlToggle(event));
sessionControlEnabled.addEventListener("change", (event) => onControlToggle(event));
toolMouse.addEventListener("click", () => {
  state.localMouse = !state.localMouse;
  render();
});
toolKeyboard.addEventListener("click", () => {
  state.localKeyboard = !state.localKeyboard;
  render();
});
toolFullscreen.addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void viewController.requestFullscreen();
});
toolQuality.addEventListener("click", (event) => {
  event.stopPropagation();
  state.qualityOpen = !state.qualityOpen;
  render();
});
profile.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = profileMenu.hidden;
  profileMenu.hidden = !open;
  profile.setAttribute("aria-expanded", open ? "true" : "false");
});
for (const button of navButtons) {
  button.addEventListener("click", () => {
    if (state.controllerPhase === "connecting") return;
    const nav = button.dataset.nav;
    if (nav !== "device" && nav !== "devices" && nav !== "history") return;
    state.nav = nav;
    if (state.controllerPhase === "ended") state.controllerPhase = "idle";
    render();
  });
}
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (state.qualityOpen && !qualityPop.contains(target) && !toolQuality.contains(target)) {
    state.qualityOpen = false;
    qualityPop.hidden = true;
    toolQuality.setAttribute("aria-expanded", "false");
  }
  if (!profileMenu.hidden && !profileMenu.contains(target) && !profile.contains(target)) {
    profileMenu.hidden = true;
    profile.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("fullscreenchange", () => render());
video.addEventListener("loadedmetadata", () => revealRemoteFrame());
video.addEventListener("resize", () => revealRemoteFrame());
video.addEventListener("playing", () => revealRemoteFrame());

const preview = new URLSearchParams(location.search).get("preview");
if (preview) {
  applyPreview(preview);
  render();
} else {
  void boot();
  render();
}

async function boot(): Promise<void> {
  if (!window.desktop) {
    state.signaling = "error";
    state.hostError = "读不到桌面配置。";
    render();
    return;
  }
  try {
    const config = await window.desktop.getConfig();
    state.signalingUrl = config.signalingUrl;
    state.iceServers = config.iceServers;
    state.iceTransportPolicy = config.iceTransportPolicy;
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
        state.auth = false;
        state.accepted = false;
        resetHostPolicy();
        window.desktop.endInputSession();
      }
      if (becameOpen) sendCreateRoom();
      render();
    },
    onMessage: (message) => {
      if (message.type === "room-created") {
        state.hostCode = message.code;
        state.hostPeer = "waiting";
        if (state.hostError === REJECT_NOTICE) {
          state.hostError = "";
          clearHostNoticeTimer();
        }
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
      resetHostPolicy();
      state.hostPeer = "connected";
      state.accepted = false;
      state.auth = true;
      state.capture = "";
      state.sessionRecorded = false;
      render();
      return;
    case "peer-left": {
      stopHostPeer();
      window.desktop?.endInputSession();
      const wasAccepted = state.accepted;
      state.auth = false;
      state.accepted = false;
      resetHostPolicy();
      state.hostPeer = state.hostCode ? "waiting" : "offline";
      state.capture = "";
      if (wasAccepted) {
        noteHistory("host");
        if (state.controllerPhase !== "live") state.controllerPhase = "ended";
      }
      render();
      return;
    }
    case "signal":
      if (message.from !== "controller") return;
      void hostPeerSession?.acceptSignal(message.payload);
      return;
    case "password-updated":
      state.hostTone = "ok";
      state.hostError = message.enabled ? "安全连接码已更新。" : "已关闭安全连接码。";
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
    state.hostError = "安全连接码无效，已用无密码方式创建房间。";
    hostClient?.send({ type: "create-room" });
    return;
  }
  hostClient?.send(password ? { type: "create-room", password } : { type: "create-room" });
}

function applyPassword(): void {
  const password = readHostPassword();
  if (password === null) {
    state.hostTone = "error";
    state.hostError = "安全连接码不能包含控制字符，最长 64 位。";
    render();
    return;
  }
  if (!state.hostCode) {
    state.hostTone = "error";
    state.hostError = "房间还没创建，连上信令后会使用这个安全连接码。";
    render();
    return;
  }
  hostClient?.send(password ? { type: "set-password", password } : { type: "set-password" });
  render();
}

function commitPasswordFromEditor(): void {
  const normalized = normalizeTemporaryPassword(pwValue.value);
  if (normalized === null) {
    state.hostTone = "error";
    state.hostError = "安全连接码不能包含控制字符，最长 64 位。";
    render();
    return;
  }
  if (normalized === undefined) {
    state.passwordEnabled = false;
    state.password = "";
    state.secureShown = false;
  } else {
    state.passwordEnabled = true;
    state.password = normalized;
  }
  state.editingPassword = false;
  applyPassword();
}

function rotateDeviceCode(): void {
  if (state.signaling !== "open" || state.auth || state.accepted || state.hostPeer === "connected") return;
  state.hostError = "";
  state.hostCode = "";
  hostClient?.send({ type: "leave" });
  sendCreateRoom();
  render();
}

/**
 * The room has no kick message. Refusing the incoming controller drops the
 * room and creates a new device code so the slot is free again.
 */
function rejectIncoming(): void {
  if (!state.auth) return;
  state.auth = false;
  state.accepted = false;
  stopHostPeer();
  window.desktop?.endInputSession();
  resetHostPolicy();
  state.hostCode = "";
  state.hostPeer = "offline";
  state.capture = "";
  state.hostTone = "error";
  state.hostError = REJECT_NOTICE;
  clearHostNoticeTimer();
  hostNoticeTimer = setTimeout(() => {
    hostNoticeTimer = null;
    if (state.hostError !== REJECT_NOTICE) return;
    state.hostError = "";
    render();
  }, 4000);
  hostClient?.send({ type: "leave" });
  sendCreateRoom();
  render();
}

function acceptIncoming(allowControl: boolean): void {
  if (!state.auth || !window.desktop) return;
  state.auth = false;
  state.accepted = true;
  state.sessionRecorded = false;
  state.hostPeer = "connected";
  state.sharing = DEFAULT_SHARING_ENABLED;
  state.control = allowControl;
  state.capture = "正在采集画面…";
  hostPeerSession = startHostSession({
    ...rtcTransport(),
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
  if (allowControl) hostPeerSession.setRemoteControl(true);
  render();
}

function connectToDevice(): void {
  const parsed = parseConnectInput(remoteCode.value);
  if (!parsed) {
    state.connectError = "请输入 9 位设备码。";
    state.nav = "device";
    state.controllerPhase = "idle";
    render();
    return;
  }
  const password = parsed.password ? normalizeTemporaryPassword(parsed.password) : undefined;
  if (password === null) {
    state.connectError = "安全连接码无效。";
    state.nav = "device";
    state.controllerPhase = "idle";
    render();
    return;
  }
  if (!state.signalingUrl) {
    state.connectError = "信令地址还没准备好。";
    render();
    return;
  }

  stopController();
  resetRemotePolicy();
  state.localMouse = true;
  state.localKeyboard = true;
  state.sessionRecorded = false;
  state.lastRemoteCode = parsed.code;
  state.controllerPhase = "connecting";
  state.connectError = "";
  stagePlaceholder.hidden = false;
  stagePlaceholder.textContent = "等待对方画面…";
  render();

  const gen = controllerGen;
  const code = parsed.code;
  const client = new SignalingClient(state.signalingUrl, {
    reconnect: false,
    onStatus: (status) => {
      if (gen !== controllerGen) return;
      if (status === "open") {
        client.send(password ? { type: "join-room", code, password } : { type: "join-room", code });
      }
      if (status === "closed" && state.controllerPhase === "connecting") {
        failController("信令连接已断开。", false);
      }
    },
    onMessage: (message) => {
      if (gen !== controllerGen) return;
      handleControllerMessage(message, gen);
    },
  });
  controllerClient = client;
  client.connect();
}

function handleControllerMessage(message: ServerMessage, gen: number): void {
  switch (message.type) {
    case "joined":
      controllerPeer = startControllerSession({
        ...rtcTransport(),
        stage,
        video,
        localMouse: () => state.localMouse,
        localKeyboard: () => state.localKeyboard,
        sendSignal: (payload) => controllerClient?.send({ type: "signal", payload }),
        onConnectionState: (connection) => {
          if (gen !== controllerGen) return;
          if (connection === "connected") {
            clearControllerDisconnectTimer();
            state.controllerPhase = "live";
            stage.focus();
            render();
            return;
          }
          if (connection === "disconnected") {
            if (controllerDisconnectTimer) return;
            controllerDisconnectTimer = setTimeout(() => {
              controllerDisconnectTimer = null;
              if (gen !== controllerGen) return;
              const established = state.controllerPhase === "live";
              failController(established ? "对方已结束会话。" : "连接已结束。", established);
            }, CONTROLLER_DISCONNECT_GRACE_MS);
            return;
          }
          if (connection === "failed" || connection === "closed") {
            const established = state.controllerPhase === "live";
            failController(established ? "对方已结束会话。" : "连接已结束。", established);
            return;
          }
          render();
        },
        onSessionState: (session) => applyRemoteSession(session),
      });
      render();
      return;
    case "signal":
      if (message.from !== "host") return;
      void controllerPeer?.acceptSignal(message.payload);
      return;
    case "peer-left":
      failController("对方已结束会话。", state.controllerPhase === "live");
      return;
    case "error":
      failController(ERROR_TEXT[message.code], false);
      return;
    default:
      return;
  }
}

function failController(text: string, ended: boolean): void {
  const showEnded = ended || state.controllerPhase === "live";
  if (showEnded) noteHistory("controller");
  stopController();
  resetRemotePolicy();
  state.localMouse = true;
  state.localKeyboard = true;
  stagePlaceholder.hidden = false;
  stagePlaceholder.textContent = "等待对方画面…";
  if (showEnded) {
    state.controllerPhase = "ended";
    state.connectError = "";
  } else {
    state.controllerPhase = "idle";
    state.connectError = text;
    state.nav = "device";
  }
  render();
}

function cancelController(): void {
  stopController();
  resetRemotePolicy();
  state.controllerPhase = "idle";
  state.connectError = "";
  render();
}

function disconnectGuest(): void {
  const had = state.accepted;
  stopHostPeer();
  window.desktop?.endInputSession();
  resetHostPolicy();
  state.auth = false;
  state.accepted = false;
  state.capture = "";
  state.hostPeer = state.hostCode ? "waiting" : "offline";
  if (had) {
    noteHistory("host");
    state.controllerPhase = "ended";
    hostClient?.send({ type: "end-session" });
  }
  render();
}

function toggleSharing(): void {
  if (!state.accepted || state.hostPeer !== "connected" || !hostPeerSession) return;
  const next = !state.sharing;
  state.sharing = next;
  state.capture = next ? "正在采集画面…" : "已停止共享，房间仍在。";
  hostPeerSession.setSharing(next);
  render();
}

function onControlToggle(event: Event): void {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (!state.accepted || state.hostPeer !== "connected" || !hostPeerSession) {
    input.checked = false;
    return;
  }
  state.control = input.checked;
  hostPeerSession.setRemoteControl(state.control);
  render();
}

function applyRemoteSession(session: SessionState): void {
  state.remoteSharing = session.sharing;
  state.remoteControl = session.control;
  render();
}

function resetHostPolicy(): void {
  state.sharing = DEFAULT_SHARING_ENABLED;
  state.control = DEFAULT_REMOTE_CONTROL_ENABLED;
}

function resetRemotePolicy(): void {
  state.remoteSharing = DEFAULT_SHARING_ENABLED;
  state.remoteControl = DEFAULT_REMOTE_CONTROL_ENABLED;
}

function revealRemoteFrame(): void {
  if (state.controllerPhase !== "live" || !state.remoteSharing) return;
  if (video.videoWidth > 0 && video.srcObject) stagePlaceholder.hidden = true;
}

function stopHostPeer(): void {
  hostPeerSession?.stop();
  hostPeerSession = null;
}

function stopController(): void {
  clearControllerDisconnectTimer();
  controllerGen += 1;
  const client = controllerClient;
  controllerClient = null;
  controllerPeer?.stop();
  controllerPeer = null;
  client?.send({ type: "leave" });
  client?.close();
  video.srcObject = null;
}

function rtcTransport(): { iceServers: RTCIceServer[]; iceTransportPolicy: RTCIceTransportPolicy } {
  return { iceServers: state.iceServers, iceTransportPolicy: state.iceTransportPolicy };
}

function clearHostNoticeTimer(): void {
  if (!hostNoticeTimer) return;
  clearTimeout(hostNoticeTimer);
  hostNoticeTimer = null;
}

function clearControllerDisconnectTimer(): void {
  if (!controllerDisconnectTimer) return;
  clearTimeout(controllerDisconnectTimer);
  controllerDisconnectTimer = null;
}

function readHostPassword(): string | undefined | null {
  if (!state.passwordEnabled) return undefined;
  return normalizeTemporaryPassword(state.password);
}

function render(): void {
  const connecting = state.controllerPhase === "connecting";
  const ended = state.controllerPhase === "ended";
  const session = state.controllerPhase === "live";
  const guest = state.accepted && state.hostPeer === "connected" && !session;

  presence.textContent = presenceText();
  presenceDot.className = `presence-dot ${state.signaling === "error" ? "closed" : state.signaling}`;
  sigLine.textContent = signalingLabel();

  for (const button of navButtons) {
    const current = button.dataset.nav === state.nav;
    if (current) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
    button.disabled = connecting;
  }

  if (state.hostCode) {
    deviceCode.textContent = formatDeviceCode(state.hostCode);
    deviceCode.dataset.pending = "false";
  } else {
    deviceCode.textContent = "— — —";
    deviceCode.dataset.pending = "true";
  }
  copyCode.disabled = !state.hostCode;
  codeRotate.disabled =
    state.signaling !== "open" || state.auth || state.accepted || state.hostPeer === "connected";

  if (!state.passwordEnabled || !state.password) {
    secureCode.textContent = "未设置";
    secureCode.dataset.pending = "true";
  } else if (state.secureShown) {
    secureCode.textContent = state.password;
    secureCode.dataset.pending = "false";
  } else {
    secureCode.textContent = "•".repeat(Math.max(6, Math.min(state.password.length, 8)));
    secureCode.dataset.pending = "false";
  }
  secureCode.hidden = state.editingPassword;
  pwEditor.hidden = !state.editingPassword;
  secureReveal.textContent = state.secureShown ? "隐藏" : "显示";
  secureReveal.disabled = !state.passwordEnabled;

  hostError.hidden = !state.hostError;
  hostError.className = state.hostTone === "ok" ? "form-error note" : "form-error";
  hostError.textContent = state.hostError;
  connectError.hidden = !state.connectError;
  connectError.textContent = state.connectError;

  viewDevice.hidden = state.nav !== "device" || connecting || ended;
  viewDevices.hidden = state.nav !== "devices" || connecting || ended;
  viewHistory.hidden = state.nav !== "history" || connecting || ended;
  viewConnecting.hidden = !connecting;
  viewDisconnected.hidden = !ended;
  renderHistory();

  shell.hidden = session || guest;
  viewController.hidden = !session;
  viewGuest.hidden = !guest;
  authModal.hidden = !state.auth || session;
  document.body.dataset.mode = session ? "session" : guest ? "guest" : "shell";
  document.body.dataset.auth = state.auth && !session ? "on" : "off";

  const hostConnected = state.accepted && state.hostPeer === "connected";
  const shareLabel = hostConnected && state.sharing ? "停止共享" : "开始共享";
  for (const button of [shareToggle, sessionShareToggle]) {
    button.disabled = !hostConnected;
    button.textContent = shareLabel;
    button.className = hostConnected && !state.sharing ? "solid" : "quiet";
  }
  for (const box of [controlEnabled, sessionControlEnabled]) {
    box.disabled = !hostConnected;
    box.checked = hostConnected && state.control;
  }
  captureStatus.textContent = state.capture;
  sessionCapture.textContent = state.capture;
  sessionHostControls.hidden = !(session && hostConnected);

  sessionTitle.textContent = controllerHeadline();
  toolMouse.disabled = !state.remoteControl;
  toolKeyboard.disabled = !state.remoteControl;
  toolMouse.setAttribute("aria-pressed", state.localMouse ? "true" : "false");
  toolKeyboard.setAttribute("aria-pressed", state.localKeyboard ? "true" : "false");
  toolMouse.classList.toggle("is-off", !state.localMouse || !state.remoteControl);
  toolKeyboard.classList.toggle("is-off", !state.localKeyboard || !state.remoteControl);
  toolFullscreen.setAttribute("aria-pressed", document.fullscreenElement ? "true" : "false");
  toolQuality.setAttribute("aria-expanded", state.qualityOpen ? "true" : "false");
  qualityPop.hidden = !state.qualityOpen;

  stage.dataset.sharing = state.remoteSharing ? "on" : "off";
  stage.dataset.control = state.remoteControl && state.localMouse ? "on" : "off";
  if (session && !state.remoteSharing) {
    stagePlaceholder.hidden = false;
    stagePlaceholder.textContent = "对方已停止共享";
  } else if (session && state.remoteSharing) {
    stagePlaceholder.textContent = "等待对方画面…";
    stagePlaceholder.hidden = video.videoWidth > 0 && Boolean(video.srcObject);
  }
}

function controllerHeadline(): string {
  if (!state.remoteSharing) return "正在帮小旭 · 已停止共享";
  if (state.remoteControl) return "正在帮小旭 · 可控制";
  return "正在帮小旭 · 仅查看";
}

function renderHistory(): void {
  historyEmpty.hidden = state.history.length > 0;
  historyList.hidden = state.history.length === 0;
  historyList.replaceChildren();
  for (const item of state.history) {
    const row = document.createElement("article");
    row.className = "row";
    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.src = "./assets/mascot.png";
    avatar.alt = "";
    const text = document.createElement("p");
    text.className = "row-text";
    text.textContent = `${item.title} · ${formatWhen(item.at)} · 已断开`;
    row.append(avatar, text);
    if (item.code && /^\d{9}$/.test(item.code)) {
      const again = document.createElement("button");
      again.type = "button";
      again.className = "again";
      again.textContent = "再连一次";
      const code = item.code;
      again.addEventListener("click", () => {
        remoteCode.value = formatDeviceCode(code);
        state.nav = "device";
        connectToDevice();
      });
      row.append(again);
    }
    historyList.append(row);
  }
}

function noteHistory(role: "host" | "controller"): void {
  if (state.sessionRecorded) return;
  state.sessionRecorded = true;
  const code = role === "controller" ? state.lastRemoteCode : undefined;
  state.history.unshift({
    id: `${Date.now()}-${role}`,
    title: "小旭",
    at: Date.now(),
    ...(code ? { code } : {}),
  });
  state.history = state.history.slice(0, 20);
  saveHistory();
}

function presenceText(): string {
  if (state.signaling === "open") return "在线";
  if (state.signaling === "connecting") return "连接中";
  return "离线";
}

function signalingLabel(): string {
  if (state.signaling === "open") return `信令已连接 ${state.signalingUrl}`;
  if (state.signaling === "connecting") return "正在连接信令…";
  if (state.signaling === "error") return "桌面配置不可用";
  return "信令未连接，正在重试…";
}

async function copyText(text: string, button: HTMLButtonElement, restore: string): Promise<void> {
  const ok = window.desktop ? await window.desktop.copyText(text) : true;
  button.textContent = ok ? "已复制" : "复制失败";
  window.setTimeout(() => {
    button.textContent = restore;
  }, 1200);
}

function generatePassword(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length] ?? "A").join("");
}

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryItem).slice(0, 20);
  } catch {
    return [];
  }
}

function saveHistory(): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  } catch {
    // The page still works if storage is blocked.
  }
}

function isHistoryItem(value: unknown): value is HistoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as HistoryItem;
  return typeof item.id === "string" && typeof item.title === "string" && typeof item.at === "number";
}

function formatWhen(at: number): string {
  const date = new Date(at);
  const now = new Date();
  const hm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (at >= start) return `今天 ${hm}`;
  if (at >= start - 86_400_000) return "昨天";
  return `周${"日一二三四五六"[date.getDay()] ?? ""}`;
}

function applyPreview(name: string): void {
  state.signaling = "open";
  state.signalingUrl = "ws://127.0.0.1:8787";
  state.hostCode = "123456789";
  state.hostPeer = "waiting";
  state.password = "XQ8LR4";
  state.passwordEnabled = true;
  state.secureShown = name === "home" || name === "auth";
  if (name === "devices") state.nav = "devices";
  if (name === "history") {
    state.nav = "history";
    const now = Date.now();
    state.history = [
      { id: "1", title: "小旭", at: now, code: "123456789" },
      { id: "2", title: "家里的电脑", at: now - 86_400_000 },
      { id: "3", title: "小旭", at: now - 4 * 86_400_000 },
    ];
  }
  if (name === "auth") state.auth = true;
  if (name === "connecting") state.controllerPhase = "connecting";
  if (name === "controller") {
    state.controllerPhase = "live";
    state.remoteControl = true;
    state.remoteSharing = true;
  }
  if (name === "guest") {
    state.hostPeer = "connected";
    state.accepted = true;
    state.sharing = true;
    state.control = false;
    state.capture = "采集：DXGI Desktop Duplication（H.264）";
  }
  if (name === "disconnected") state.controllerPhase = "ended";
}

function must<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}
