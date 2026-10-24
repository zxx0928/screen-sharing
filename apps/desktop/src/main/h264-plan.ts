import { DXGI_MAX_FRAME_WIDTH } from "./frame-size";

/**
 * What the host encodes today, and the GPU / RTP step that replaces the
 * canvas round trip. The Win32 addon feeds a synchronous H.264 MFT when
 * one activates. JPEG remains the fallback when that open or encode fails.
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
    encode: "media-foundation-h264-mft-sync";
    bitstream: "annex-b";
    preview: "webcodecs-videodecoder-canvas";
    fallback: "wic-jpeg-ipc-canvas";
    webrtcEncode: "chromium-rtc-rtp-sender";
    profile: "baseline";
    rateControl: "CBR";
    maxFrameWidth: number;
    maxBitrate: number;
    maxFramerate: number;
    gopLength: number;
  };
  next: {
    encoder: "media-foundation-h264-mft-async-hardware";
    pixelFormat: "NV12";
    colorConvert: "ID3D11VideoProcessor";
    delivery: "rtp-without-reencode";
    steps: readonly string[];
  };
};

export const H264_NEXT_STEPS = [
  "Keep the captured ID3D11Texture2D on the GPU. The current encoder Map()s BGRA and converts to NV12 on the CPU.",
  "Convert BGRA to NV12 with ID3D11VideoProcessor (or a VideoProcessorBlt) on the same D3D11 device.",
  "Replace the synchronous MFT with an asynchronous hardware MFT (IMFMediaEventGenerator) chosen from probeH264().",
  "Keep CBR, AVEncCommonMeanBitRate 8000000, CODECAPI_AVEncMPVGOPSize 60, MF_MT_FRAME_RATE 30/1, and eAVEncH264VProfile_Base.",
  "Pull IMFSamples, prepend each IDR with SPS/PPS, and keep emitting Annex-B (00 00 00 01 + NAL).",
  "Insert those access units into the WebRTC RTP sender. Until that lands, the renderer decodes Annex-B with WebCodecs, draws a canvas, and Chromium encodes the canvas again.",
] as const;

export function describeCapturePipeline(): CapturePipeline {
  return {
    current: {
      capture: "IDXGIOutputDuplication",
      pixelFormat: "BGRA8",
      encode: "media-foundation-h264-mft-sync",
      bitstream: "annex-b",
      preview: "webcodecs-videodecoder-canvas",
      fallback: "wic-jpeg-ipc-canvas",
      webrtcEncode: "chromium-rtc-rtp-sender",
      profile: "baseline",
      rateControl: "CBR",
      maxFrameWidth: DXGI_MAX_FRAME_WIDTH,
      maxBitrate: OUTBOUND_VIDEO_BITRATE,
      maxFramerate: OUTBOUND_VIDEO_FRAMERATE,
      gopLength: H264_GOP_LENGTH,
    },
    next: {
      encoder: "media-foundation-h264-mft-async-hardware",
      pixelFormat: "NV12",
      colorConvert: "ID3D11VideoProcessor",
      delivery: "rtp-without-reencode",
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
