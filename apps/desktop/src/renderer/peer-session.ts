import {
  DEFAULT_REMOTE_CONTROL_ENABLED,
  DEFAULT_SHARING_ENABLED,
  serializeSessionState,
  type RtcSignal,
  type SessionState,
} from "@screen-sharing/protocol";
import { OUTBOUND_VIDEO_BITRATE, OUTBOUND_VIDEO_FRAMERATE } from "../main/h264-plan";
import { acquireScreenTrack, type CaptureSource } from "./capture";
import { bindControllerInput, bindHostInputChannel, INPUT_CHANNEL_LABEL } from "./input-channel";

/**
 * Thin WebRTC session. The host offers a screen track and creates the input
 * DataChannel. The controller answers and sends input back on that channel.
 *
 * TODO(turn): add a self-hosted coturn server when peers are not on the same
 * network. Do not commit long-term TURN credentials. Same-machine and most
 * LAN sessions work with host candidates plus the public STUN server below.
 */
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export type PeerSession = {
  acceptSignal(payload: RtcSignal): Promise<void>;
  stop(): void;
};

/** Host-only. Share and remote control do not close the peer connection. */
export type HostPeerSession = PeerSession & {
  setSharing(enabled: boolean): void;
  setRemoteControl(enabled: boolean): void;
};

type SessionOptions = {
  sendSignal: (payload: RtcSignal) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onCaptureSource?: (source: CaptureSource) => void;
  onError?: (error: unknown) => void;
};

export function startHostSession(options: SessionOptions): HostPeerSession {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  let stopped = false;
  let offered = false;
  let track: MediaStreamTrack | null = null;
  let sharing = DEFAULT_SHARING_ENABLED;
  let control = DEFAULT_REMOTE_CONTROL_ENABLED;
  let chain: Promise<void> = Promise.resolve();
  const acceptSignal = createRemoteSignalHandler(pc, "host", options.sendSignal);
  attachIce(pc, options.sendSignal);
  watchState(pc, options.onConnectionState);

  // The video m-line is negotiated once. Later start/stop only replaces the track.
  const sender = pc.addTransceiver("video", { direction: "sendonly" }).sender;
  const channel = pc.createDataChannel(INPUT_CHANNEL_LABEL, { ordered: true });

  const publish = (): void => {
    if (stopped || channel.readyState !== "open") return;
    channel.send(serializeSessionState(sharing, control));
    console.log(`[session] sharing=${sharing} control=${control}`);
  };

  bindHostInputChannel(
    channel,
    () => control,
    () => publish(),
  );
  channel.addEventListener("open", () => publish());
  window.desktop.setRemoteControl(control);

  const enqueue = (task: () => Promise<void>): void => {
    chain = chain
      .then(async () => {
        if (stopped) return;
        await task();
      })
      .catch((error: unknown) => {
        if (!stopped) options.onError?.(error);
      });
  };

  enqueue(async () => {
    await syncSharing();
    await ensureOffer();
    publish();
  });

  return {
    acceptSignal,
    setSharing(enabled: boolean) {
      if (stopped || sharing === enabled) return;
      sharing = enabled;
      enqueue(async () => {
        publish();
        await syncSharing();
        await ensureOffer();
        publish();
      });
    },
    setRemoteControl(enabled: boolean) {
      if (stopped || control === enabled) return;
      control = enabled;
      window.desktop.setRemoteControl(enabled);
      publish();
    },
    stop() {
      stopped = true;
      sharing = false;
      control = false;
      window.desktop.setRemoteControl(false);
      const current = track;
      track = null;
      current?.stop();
      pc.close();
    },
  };

  async function syncSharing(): Promise<void> {
    if (stopped) return;
    if (!sharing) {
      await detachTrack();
      return;
    }
    if (track && track.readyState === "live") return;
    const plan = await window.desktop.getCapturePlan();
    if (stopped || !sharing) return;
    const captured = await acquireScreenTrack(plan);
    if (stopped || !sharing) {
      captured.track.stop();
      return;
    }
    const current = captured.track;
    track = current;
    current.addEventListener("ended", () => {
      if (!stopped && sharing && track === current) options.onError?.(new Error("Screen track ended"));
    });
    options.onCaptureSource?.(captured.source);
    await sender.replaceTrack(current);
    if (stopped || track !== current) return;
    await configureOutboundVideo(pc, current);
  }

  async function detachTrack(): Promise<void> {
    const current = track;
    track = null;
    try {
      await sender.replaceTrack(null);
    } catch (error) {
      console.warn("[capture] replaceTrack(null) failed", error);
    }
    current?.stop();
  }

  async function ensureOffer(): Promise<void> {
    if (stopped || offered) return;
    const offer = await pc.createOffer();
    if (stopped || !offer.sdp) return;
    await pc.setLocalDescription(offer);
    if (stopped) return;
    offered = true;
    options.sendSignal({ type: "offer", sdp: offer.sdp });
  }
}

export function startControllerSession(
  options: SessionOptions & {
    stage: HTMLElement;
    video: HTMLVideoElement;
    onSessionState?: (state: SessionState) => void;
  },
): PeerSession {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  let inputDispose: (() => void) | null = null;
  let remoteStream: MediaStream | null = null;
  let sharing = DEFAULT_SHARING_ENABLED;
  let control = DEFAULT_REMOTE_CONTROL_ENABLED;
  const acceptSignal = createRemoteSignalHandler(pc, "controller", options.sendSignal);
  attachIce(pc, options.sendSignal);
  watchState(pc, options.onConnectionState);

  const applyPolicy = (state: SessionState): void => {
    sharing = state.sharing;
    control = state.control;
    if (!sharing) {
      // Drop the element so the last frame is not left on screen.
      options.video.srcObject = null;
    } else if (remoteStream) {
      options.video.srcObject = remoteStream;
      void options.video.play().catch(() => undefined);
    }
    options.onSessionState?.(state);
  };

  pc.ontrack = (event) => {
    remoteStream = event.streams[0] ?? new MediaStream([event.track]);
    event.track.addEventListener("unmute", () => {
      if (!sharing || !remoteStream) return;
      options.video.srcObject = remoteStream;
      void options.video.play().catch(() => undefined);
    });
    if (!sharing) return;
    options.video.srcObject = remoteStream;
    void options.video.play().catch(() => undefined);
  };

  pc.ondatachannel = (event) => {
    if (event.channel.label !== INPUT_CHANNEL_LABEL) return;
    inputDispose?.();
    inputDispose = bindControllerInput(event.channel, options.stage, options.video, () => control, applyPolicy);
  };

  return {
    acceptSignal,
    stop() {
      inputDispose?.();
      inputDispose = null;
      remoteStream = null;
      options.video.srcObject = null;
      pc.close();
    },
  };
}

async function configureOutboundVideo(pc: RTCPeerConnection, track: MediaStreamTrack): Promise<void> {
  const sender = pc.getSenders().find((item) => item.track === track);
  if (!sender) return;
  try {
    const params = sender.getParameters();
    const existing = params.encodings ?? [];
    const encodings = existing.length > 0 ? existing : [{}];
    encodings[0] = {
      ...encodings[0],
      maxBitrate: OUTBOUND_VIDEO_BITRATE,
      maxFramerate: OUTBOUND_VIDEO_FRAMERATE,
    };
    params.encodings = encodings;
    params.degradationPreference = "balanced";
    await sender.setParameters(params);
  } catch (error) {
    console.warn("[capture] outbound video parameters were not applied", error);
  }
}

function attachIce(pc: RTCPeerConnection, sendSignal: (payload: RtcSignal) => void): void {
  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    const json = event.candidate.toJSON();
    if (!json.candidate) return;
    sendSignal({
      type: "ice",
      candidate: {
        candidate: json.candidate,
        sdpMid: json.sdpMid,
        sdpMLineIndex: json.sdpMLineIndex,
        usernameFragment: json.usernameFragment,
      },
    });
  };
}

function watchState(pc: RTCPeerConnection, onConnectionState?: (state: RTCPeerConnectionState) => void): void {
  pc.onconnectionstatechange = () => onConnectionState?.(pc.connectionState);
}

function createRemoteSignalHandler(
  pc: RTCPeerConnection,
  role: "host" | "controller",
  sendSignal: (payload: RtcSignal) => void,
): (payload: RtcSignal) => Promise<void> {
  const pending: RTCIceCandidateInit[] = [];
  let chain: Promise<void> = Promise.resolve();

  return (payload) => {
    chain = chain.then(() => apply(payload)).catch((error: unknown) => {
      console.error("[webrtc] signal error", error);
    });
    return chain;
  };

  async function apply(payload: RtcSignal): Promise<void> {
    if (pc.signalingState === "closed") return;
    if (payload.type === "ice") {
      if (!payload.candidate) return;
      if (!pc.remoteDescription) {
        pending.push(payload.candidate);
        return;
      }
      await pc.addIceCandidate(payload.candidate);
      return;
    }
    if (payload.type === "offer") {
      if (role !== "controller") return;
      await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
      await flush();
      const answer = await pc.createAnswer();
      if (!answer.sdp) return;
      await pc.setLocalDescription(answer);
      sendSignal({ type: "answer", sdp: answer.sdp });
      return;
    }
    if (role !== "host") return;
    await pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
    await flush();
  }

  async function flush(): Promise<void> {
    while (pending.length > 0) {
      const candidate = pending.shift();
      if (candidate) await pc.addIceCandidate(candidate);
    }
  }
}
