import type { RtcSignal } from "@screen-sharing/protocol";
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

type SessionOptions = {
  sendSignal: (payload: RtcSignal) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onCaptureSource?: (source: CaptureSource) => void;
  onError?: (error: unknown) => void;
};

export function startHostSession(options: SessionOptions): PeerSession {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  let stopped = false;
  let track: MediaStreamTrack | null = null;
  const acceptSignal = createRemoteSignalHandler(pc, "host", options.sendSignal);
  attachIce(pc, options.sendSignal);
  watchState(pc, options.onConnectionState);

  const channel = pc.createDataChannel(INPUT_CHANNEL_LABEL, { ordered: true });
  bindHostInputChannel(channel);

  void (async () => {
    try {
      const plan = await window.desktop.getCapturePlan();
      if (stopped) return;
      const captured = await acquireScreenTrack(plan);
      if (stopped) {
        captured.track.stop();
        return;
      }
      track = captured.track;
      track.addEventListener("ended", () => {
        if (!stopped) options.onError?.(new Error("Screen track ended"));
      });
      options.onCaptureSource?.(captured.source);
      pc.addTrack(track);
      const offer = await pc.createOffer();
      if (stopped || !offer.sdp) return;
      await pc.setLocalDescription(offer);
      options.sendSignal({ type: "offer", sdp: offer.sdp });
    } catch (error) {
      if (!stopped) options.onError?.(error);
    }
  })();

  return {
    acceptSignal,
    stop() {
      stopped = true;
      track?.stop();
      pc.close();
    },
  };
}

export function startControllerSession(
  options: SessionOptions & { stage: HTMLElement; video: HTMLVideoElement },
): PeerSession {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  let inputDispose: (() => void) | null = null;
  const acceptSignal = createRemoteSignalHandler(pc, "controller", options.sendSignal);
  attachIce(pc, options.sendSignal);
  watchState(pc, options.onConnectionState);

  pc.ontrack = (event) => {
    const [stream] = event.streams;
    options.video.srcObject = stream ?? new MediaStream([event.track]);
    void options.video.play().catch(() => undefined);
  };

  pc.ondatachannel = (event) => {
    if (event.channel.label !== INPUT_CHANNEL_LABEL) return;
    inputDispose?.();
    inputDispose = bindControllerInput(event.channel, options.stage, options.video);
  };

  return {
    acceptSignal,
    stop() {
      inputDispose?.();
      inputDispose = null;
      options.video.srcObject = null;
      pc.close();
    },
  };
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
