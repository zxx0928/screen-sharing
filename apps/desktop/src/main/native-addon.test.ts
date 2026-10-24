import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WIN32_ADDON_ABI, loadWin32AddonAt, unpackedAddonPath, win32AddonCandidates } from "./native-addon";

const here = path.dirname(fileURLToPath(import.meta.url));

test("the win32 addon is not loaded on other platforms", () => {
  let loaded = false;
  const addon = loadWin32AddonAt({
    platform: "linux",
    candidates: ["/tmp/screen_sharing_win32.node"],
    exists: () => {
      throw new Error("exists should not run");
    },
    load: () => {
      loaded = true;
      return {};
    },
  });
  assert.equal(addon, null);
  assert.equal(loaded, false);
});

test("a missing or incompatible addon does not throw", () => {
  const attempts: string[] = [];
  const addon = loadWin32AddonAt({
    platform: "win32",
    candidates: ["a.node", "b.node", "c.node"],
    exists: (file) => file !== "a.node",
    onError: () => undefined,
    load: (file) => {
      attempts.push(file);
      if (file === "b.node") throw new Error("bad image");
      return { abi: 0 };
    },
  });
  assert.equal(addon, null);
  assert.deepEqual(attempts, ["b.node", "c.node"]);
});

test("a matching abi is accepted", () => {
  const methods = {
    abi: WIN32_ADDON_ABI,
    getDesktopLayout: () => ({ displays: [], virtualScreen: { left: 0, top: 0, width: 0, height: 0 } }),
    startCapture: () => ({ ok: false, error: "unused" }),
    stopCapture: () => undefined,
    acquireFrame: () => null,
    sendInputs: () => 0,
    probeH264: () => ({ available: false, encoders: [] }),
  };
  const addon = loadWin32AddonAt({
    platform: "win32",
    candidates: ["screen_sharing_win32.node"],
    exists: () => true,
    load: () => methods,
  });
  assert.equal(addon, methods);
});

test("addon candidates sit next to the bundled main process and the node-gyp output", () => {
  const candidates = win32AddonCandidates("/app/dist");
  assert.equal(candidates[0], path.join("/app/dist", "screen_sharing_win32.node"));
  assert.equal(candidates[1], path.resolve("/app/dist", "..", "native", "win32", "build", "Release", "screen_sharing_win32.node"));
  assert.equal(unpackedAddonPath(candidates[0]), null);
});

test("a packaged build also looks in app.asar.unpacked", () => {
  const moduleDir = path.join("/Program Files/XiaoxuConnect/resources", "app.asar", "dist");
  const candidates = win32AddonCandidates(moduleDir);
  assert.equal(candidates[0], path.join(moduleDir, "screen_sharing_win32.node"));
  assert.equal(
    candidates[1],
    path.join("/Program Files/XiaoxuConnect/resources", "app.asar.unpacked", "dist", "screen_sharing_win32.node"),
  );
  assert.equal(
    unpackedAddonPath("C:\\XiaoxuConnect\\resources\\app.asar\\dist\\screen_sharing_win32.node"),
    "C:\\XiaoxuConnect\\resources\\app.asar.unpacked\\dist\\screen_sharing_win32.node",
  );
});

test("native sources call DXGI, SendInput, and ProcessInput on a synchronous H.264 MFT", () => {
  const nativeRoot = path.resolve(here, "../../native/win32");
  const nativeSrc = path.join(nativeRoot, "src");
  const sendInput = fs.readFileSync(path.join(nativeSrc, "send_input.cc"), "utf8");
  const dxgi = fs.readFileSync(path.join(nativeSrc, "dxgi_capture.cc"), "utf8");
  const probe = fs.readFileSync(path.join(nativeSrc, "mf_probe.cc"), "utf8");
  const encoder = fs.readFileSync(path.join(nativeSrc, "h264_encoder.cc"), "utf8");
  const gyp = fs.readFileSync(path.join(nativeRoot, "binding.gyp"), "utf8");
  const injection = fs.readFileSync(path.join(here, "input-injection.ts"), "utf8");
  const capture = fs.readFileSync(path.join(here, "../renderer/capture.ts"), "utf8");
  const bundle = fs.readFileSync(path.join(here, "../../scripts/bundle.mjs"), "utf8");

  assert.match(sendInput, /SendInput\(/);
  assert.match(dxgi, /d3d11_4\.h/);
  assert.match(dxgi, /ID3D11Multithread/);
  assert.match(dxgi, /DuplicateOutput\(/);
  assert.match(dxgi, /AcquireNextFrame\(/);
  assert.match(dxgi, /CreateEncoder\(GUID_ContainerFormatJpeg/);
  assert.match(dxgi, /H264Encoder/);
  assert.ok(dxgi.indexOf("ReleaseFrame()") < dxgi.indexOf("encoder.Encode("));
  assert.match(probe, /MFTEnumEx\(/);
  assert.match(probe, /MFT_TRANSFORM_CLSID_Attribute/);
  assert.doesNotMatch(probe, /MF_TRANSFORM_CLSID_Attribute/);
  assert.match(probe, /MFVideoFormat_H264/);
  assert.match(encoder, /ProcessInput\(/);
  assert.match(encoder, /MFVideoFormat_H264/);
  assert.match(encoder, /MFT_ENUM_FLAG_SYNCMFT/);
  assert.match(gyp, /h264_encoder\.cc/);
  assert.match(gyp, /wmcodecdspuuid\.lib/);
  assert.match(injection, /dispatchWin32Inputs/);
  assert.doesNotMatch(injection, /\[input\] stub/);
  assert.match(capture, /startDxgiCapture/);
  assert.match(capture, /dxgi-h264/);
  assert.doesNotMatch(capture, /TODO\(windows-dxgi\)/);
  assert.match(bundle, /screen_sharing_win32/);
});
