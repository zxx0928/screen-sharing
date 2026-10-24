import assert from "node:assert/strict";
import test from "node:test";
import { chooseDisplayIndex, resolveCapturePlan } from "./capture-resolve";
import { DXGI_MAX_FRAME_WIDTH, fitEvenFrame } from "./frame-size";
import { describeCapturePipeline, summarizeH264Probe } from "./h264-plan";

test("capture plan prefers DXGI on Windows and keeps getDisplayMedia elsewhere", () => {
  assert.deepEqual(
    resolveCapturePlan({ platform: "win32", nativeReady: true, displayIndex: 2, fallbackSourceId: "screen:1" }),
    { mode: "dxgi", displayIndex: 2, fallbackSourceId: "screen:1" },
  );
  assert.deepEqual(
    resolveCapturePlan({ platform: "win32", nativeReady: false, displayIndex: 0, fallbackSourceId: "screen:1" }),
    { mode: "electron-desktop", sourceId: "screen:1" },
  );
  assert.deepEqual(
    resolveCapturePlan({ platform: "linux", nativeReady: false, displayIndex: 0, fallbackSourceId: null }),
    { mode: "display-media" },
  );
  assert.deepEqual(
    resolveCapturePlan({ platform: "linux", nativeReady: true, displayIndex: 1, fallbackSourceId: "screen:9" }),
    { mode: "display-media" },
  );
  assert.equal(chooseDisplayIndex([{ index: 0, primary: false }, { index: 3, primary: true }]), 3);
  assert.equal(chooseDisplayIndex([]), 0);
});

test("jpeg frame size stays even and matches the documented examples", () => {
  assert.equal(DXGI_MAX_FRAME_WIDTH, 1920);
  assert.deepEqual(fitEvenFrame(1920, 1080, 1920), { width: 1920, height: 1080 });
  assert.deepEqual(fitEvenFrame(2560, 1440, 1920), { width: 1920, height: 1080 });
  assert.deepEqual(fitEvenFrame(3840, 2160, 1920), { width: 1920, height: 1080 });
  assert.deepEqual(fitEvenFrame(1366, 768, 1920), { width: 1366, height: 768 });
  assert.deepEqual(fitEvenFrame(1365, 769, 1920), { width: 1364, height: 768 });
  assert.equal(fitEvenFrame(1, 1080, 1920), null);
});

test("H.264 next step is an explicit Media Foundation plan, not a placeholder comment", () => {
  const pipeline = describeCapturePipeline();
  assert.equal(pipeline.current.capture, "IDXGIOutputDuplication");
  assert.equal(pipeline.current.pixelFormat, "BGRA8");
  assert.equal(pipeline.current.frameTransport, "wic-jpeg-ipc-canvas");
  assert.equal(pipeline.current.webrtcEncode, "chromium-rtc-rtp-sender");
  assert.equal(pipeline.next.encoder, "media-foundation-h264-mft");
  assert.equal(pipeline.next.pixelFormat, "NV12");
  assert.equal(pipeline.next.profile, "baseline");
  assert.equal(pipeline.next.rateControl, "CBR");
  assert.equal(pipeline.next.bitstream, "annex-b");
  assert.equal(pipeline.next.bitrate, 8_000_000);
  assert.equal(pipeline.next.frameRate, 30);
  assert.equal(pipeline.next.gopLength, 60);
  assert.ok(pipeline.next.steps.length >= 6);
  assert.match(pipeline.next.steps.join("\n"), /ID3D11VideoProcessor/);
  assert.match(pipeline.next.steps.join("\n"), /Annex-B/);
  assert.equal(summarizeH264Probe({ available: true, encoders: [{ name: "NVIDIA", clsid: "{x}", hardware: true }] }), "h264 mft 1 encoder(s), 1 hardware");
  assert.equal(summarizeH264Probe({ available: false, error: "MFStartup failed", encoders: [] }), "h264 mft unavailable: MFStartup failed");
});
