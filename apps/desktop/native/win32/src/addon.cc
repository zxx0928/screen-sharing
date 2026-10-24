#include "dxgi_capture.h"
#include "mf_probe.h"
#include "napi_util.h"
#include "send_input.h"

#include <vector>

namespace {

MappedInput ParseCommand(napi_env env, napi_value item) {
  const std::string type = GetString(env, item, "type");
  MappedInput input;
  if (type == "mouse") {
    input.type = MappedInput::Mouse;
    input.dx = GetInt(env, item, "dx");
    input.dy = GetInt(env, item, "dy");
    input.mouseData = GetInt(env, item, "mouseData");
    const int32_t flags = GetInt(env, item, "flags");
    if (flags < 0) throw std::runtime_error("mouse flags must be non-negative");
    input.flags = static_cast<uint32_t>(flags);
    return input;
  }
  if (type == "key") {
    input.type = MappedInput::Key;
    const int32_t scan = GetInt(env, item, "scan");
    const int32_t flags = GetInt(env, item, "flags");
    if (scan < 0 || flags < 0) throw std::runtime_error("key fields must be non-negative");
    input.scan = static_cast<uint32_t>(scan);
    input.flags = static_cast<uint32_t>(flags);
    return input;
  }
  throw std::runtime_error("unknown input type");
}

napi_value GetDesktopLayoutImpl(napi_env env, napi_callback_info /*info*/) {
  const DxgiLayout layout = QueryDesktopLayout();
  JsObject result(env);
  napi_value displays;
  NapiCheck(napi_create_array_with_length(env, layout.displays.size(), &displays), "displays");
  for (size_t i = 0; i < layout.displays.size(); ++i) {
    const DxgiDisplay& display = layout.displays[i];
    JsObject item(env);
    item.setInt("index", display.index);
    item.setInt("originX", display.originX);
    item.setInt("originY", display.originY);
    item.setInt("width", display.width);
    item.setInt("height", display.height);
    item.setBool("primary", display.primary);
    item.setString("name", display.name);
    NapiCheck(napi_set_element(env, displays, static_cast<uint32_t>(i), item.get()), "display");
  }
  result.set("displays", displays);
  JsObject virtualScreen(env);
  virtualScreen.setInt("left", layout.virtualLeft);
  virtualScreen.setInt("top", layout.virtualTop);
  virtualScreen.setInt("width", layout.virtualWidth);
  virtualScreen.setInt("height", layout.virtualHeight);
  result.set("virtualScreen", virtualScreen.get());
  if (!layout.error.empty()) result.setString("error", layout.error);
  return result.get();
}

napi_value StartCaptureImpl(napi_env env, napi_callback_info info) {
  const int32_t displayIndex = [&] {
    napi_value value = Argv(env, info, 0, 2);
    int32_t parsed = 0;
    NapiCheck(napi_get_value_int32(env, value, &parsed), "displayIndex");
    return parsed;
  }();
  const int32_t maxFrameWidth = [&] {
    napi_value value = Argv(env, info, 1, 2);
    int32_t parsed = 0;
    NapiCheck(napi_get_value_int32(env, value, &parsed), "maxFrameWidth");
    return parsed;
  }();

  const DxgiStart started = StartDesktopCapture(displayIndex, maxFrameWidth);
  JsObject result(env);
  result.setBool("ok", started.ok);
  if (!started.ok) {
    result.setString("error", started.error.empty() ? "DXGI capture failed" : started.error);
    return result.get();
  }
  result.setInt("originX", started.originX);
  result.setInt("originY", started.originY);
  result.setInt("captureWidth", started.captureWidth);
  result.setInt("captureHeight", started.captureHeight);
  result.setInt("frameWidth", started.frameWidth);
  result.setInt("frameHeight", started.frameHeight);
  return result.get();
}

napi_value StopCaptureImpl(napi_env env, napi_callback_info /*info*/) {
  StopDesktopCapture();
  napi_value undefined;
  NapiCheck(napi_get_undefined(env, &undefined), "undefined");
  return undefined;
}

napi_value AcquireFrameImpl(napi_env env, napi_callback_info info) {
  napi_value sinceValue = Argv(env, info, 0, 1);
  double since = 0;
  NapiCheck(napi_get_value_double(env, sinceValue, &since), "sinceFrameId");
  const uint64_t sinceId = since > 0 ? static_cast<uint64_t>(since) : 0;
  DxgiJpegFrame frame;
  if (!CopyLatestJpeg(sinceId, frame) || frame.jpeg.empty()) return JsNull(env);

  JsObject result(env);
  result.set("frameId", JsU64(env, frame.frameId));
  result.setInt("width", frame.width);
  result.setInt("height", frame.height);
  result.setInt("originX", frame.originX);
  result.setInt("originY", frame.originY);
  napi_value buffer;
  void* data = nullptr;
  NapiCheck(napi_create_buffer_copy(env, frame.jpeg.size(), frame.jpeg.data(), &data, &buffer), "jpeg");
  result.set("jpeg", buffer);
  return result.get();
}

napi_value SendInputsImpl(napi_env env, napi_callback_info info) {
  napi_value list = Argv(env, info, 0, 1);
  bool isArray = false;
  NapiCheck(napi_is_array(env, list, &isArray), "sendInputs");
  if (!isArray) throw std::runtime_error("sendInputs expects an array");
  uint32_t length = 0;
  NapiCheck(napi_get_array_length(env, list, &length), "sendInputs length");

  std::vector<MappedInput> commands;
  commands.reserve(length);
  for (uint32_t i = 0; i < length; ++i) {
    napi_value item;
    NapiCheck(napi_get_element(env, list, i, &item), "sendInputs item");
    commands.push_back(ParseCommand(env, item));
  }
  std::string error;
  const int sent = SendMappedInputs(commands, error);
  return JsInt(env, sent);
}

napi_value ProbeH264Impl(napi_env env, napi_callback_info /*info*/) {
  const H264Probe probe = ProbeH264Encoders();
  JsObject result(env);
  result.setBool("available", probe.available);
  if (!probe.error.empty()) result.setString("error", probe.error);
  napi_value encoders;
  NapiCheck(napi_create_array_with_length(env, probe.encoders.size(), &encoders), "encoders");
  for (size_t i = 0; i < probe.encoders.size(); ++i) {
    const H264EncoderInfo& encoder = probe.encoders[i];
    JsObject item(env);
    item.setString("name", encoder.name);
    item.setString("clsid", encoder.clsid);
    item.setBool("hardware", encoder.hardware);
    NapiCheck(napi_set_element(env, encoders, static_cast<uint32_t>(i), item.get()), "encoder");
  }
  result.set("encoders", encoders);
  return result.get();
}

NAPI_METHOD(GetDesktopLayout, GetDesktopLayoutImpl)
NAPI_METHOD(StartCapture, StartCaptureImpl)
NAPI_METHOD(StopCapture, StopCaptureImpl)
NAPI_METHOD(AcquireFrame, AcquireFrameImpl)
NAPI_METHOD(SendInputs, SendInputsImpl)
NAPI_METHOD(ProbeH264, ProbeH264Impl)

void DestroyAddon(napi_env /*env*/, void* /*data*/, void* /*hint*/) { StopDesktopCapture(); }

}  // namespace

napi_value Init(napi_env env, napi_value exports) {
  try {
    napi_set_instance_data(env, exports, DestroyAddon, nullptr);
    napi_value abi = JsInt(env, 1);
    NapiCheck(napi_set_named_property(env, exports, "abi", abi), "abi");

    const napi_property_descriptor props[] = {
        {"getDesktopLayout", nullptr, GetDesktopLayout, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"startCapture", nullptr, StartCapture, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"stopCapture", nullptr, StopCapture, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"acquireFrame", nullptr, AcquireFrame, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"sendInputs", nullptr, SendInputs, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"probeH264", nullptr, ProbeH264, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    NapiCheck(napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props), "exports");
    return exports;
  } catch (const std::exception& ex) {
    napi_throw_error(env, nullptr, ex.what());
    return nullptr;
  }
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
