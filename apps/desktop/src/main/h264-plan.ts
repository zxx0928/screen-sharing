import { DXGI_MAX_FRAME_WIDTH } from "./frame-size";

/**
 * What the host encodes today, and the Media Foundation H.264 step that
 * replaces the JPEG bridge. `probeH264()` in the Win32 addon already
 * enumerates these MFTs; it does not feed them samples yet.
 *
 * The renderer imports this module for the outbound bitrate. Keep it free
 * of Node and native imports.
 */
export const OUTBOUND_VIDEO_BITRATE = 8_000_000;
export const OUTBOUND_VIDEO_FRAMERATE = 30;
export const H264_GOP_LENGTH = 60;

export type CapturePipeline = {
  current: {
    capture: "IDXGIOutputDuplication";
    pixelFormat: "BGRA8";
    frameTransport: "wic-jpeg-ipc-canvas";
    webrtcEncode: "chromium-rtc-rtp-sender";
    maxFrameWidth: number;
    maxBitrate: number;
    maxFramerate: number;
  };
  next: {
    encoder: "media-foundation-h264-mft";
    pixelFormat: "NV12";
    bitrate: number;
    frameRate: number;
    gopLength: number;
    profile: "baseline";
    rateControl: "CBR";
    bitstream: "annex-b";
    steps: readonly string[];
  };
};

export const H264_NEXT_STEPS = [
  "Keep the captured ID3D11Texture2D on the GPU. Do not Map() it for the encoder path.",
  "Convert BGRA to NV12 with ID3D11VideoProcessor (or a VideoProcessorBlt) on the same D3D11 device.",
  "Pick the first hardware encoder from probeH264(); otherwise the software CMS H.264 MFT.",
  "Set AVEncCommonRateControlMode to CBR, AVEncCommonMeanBitRate to 8000000, CODECAPI_AVEncMPVGOPSize to 60, MF_MT_FRAME_RATE to 30/1, and eAVEncH264VProfile_Base.",
  "Pull IMFSamples, prepend each IDR with SPS/PPS, and emit Annex-B (00 00 00 01 + NAL).",
  "Deliver those access units to the renderer on the existing frame port and replace the JPEG canvas track. Until that lands, Chromium's RTCRtpSender encodes the canvas.",
] as const;

export function describeCapturePipeline(): CapturePipeline {
  return {
    current: {
      capture: "IDXGIOutputDuplication",
      pixelFormat: "BGRA8",
      frameTransport: "wic-jpeg-ipc-canvas",
      webrtcEncode: "chromium-rtc-rtp-sender",
      maxFrameWidth: DXGI_MAX_FRAME_WIDTH,
      maxBitrate: OUTBOUND_VIDEO_BITRATE,
      maxFramerate: OUTBOUND_VIDEO_FRAMERATE,
    },
    next: {
      encoder: "media-foundation-h264-mft",
      pixelFormat: "NV12",
      bitrate: OUTBOUND_VIDEO_BITRATE,
      frameRate: OUTBOUND_VIDEO_FRAMERATE,
      gopLength: H264_GOP_LENGTH,
      profile: "baseline",
      rateControl: "CBR",
      bitstream: "annex-b",
      steps: H264_NEXT_STEPS,
    },
  };
}

export type H264EncoderInfo = {
  name: string;
  clsid: string;
  hardware: boolean;
};

export type H264Probe = {
  available: boolean;
  error?: string;
  encoders: H264EncoderInfo[];
};

export function summarizeH264Probe(probe: H264Probe): string {
  if (!probe.available || probe.encoders.length === 0) {
    return probe.error ? `h264 mft unavailable: ${probe.error}` : "h264 mft unavailable";
  }
  const hardware = probe.encoders.filter((encoder) => encoder.hardware).length;
  return `h264 mft ${probe.encoders.length} encoder(s), ${hardware} hardware`;
}
