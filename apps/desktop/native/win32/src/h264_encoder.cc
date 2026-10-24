#include "h264_encoder.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mftransform.h>
#include <mferror.h>
// SDK 10.0.26100 declares ICodecAPI here. strmif.h no longer exposes it to desktop includes.
#include <icodecapi.h>
#include <codecapi.h>
#include <wrl/client.h>

#include <cstdio>
#include <cstring>

using Microsoft::WRL::ComPtr;

namespace {

std::string HresultText(const char* where, HRESULT hr) {
  char buffer[160];
  std::snprintf(buffer, sizeof(buffer), "%s failed (0x%08lX)", where, static_cast<unsigned long>(hr));
  return buffer;
}

std::string WideToUtf8(const wchar_t* value) {
  if (!value || value[0] == L'\0') return {};
  const int bytes = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
  if (bytes <= 1) return {};
  std::string out(static_cast<size_t>(bytes - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value, -1, out.data(), bytes, nullptr, nullptr);
  return out;
}

uint8_t ClampByte(int value) {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return static_cast<uint8_t>(value);
}

void BgraToNv12(const uint8_t* bgra, int width, int height, int stride, std::vector<uint8_t>& nv12) {
  const int ySize = width * height;
  nv12.resize(static_cast<size_t>(ySize) + static_cast<size_t>(ySize) / 2);
  uint8_t* yPlane = nv12.data();
  uint8_t* uvPlane = nv12.data() + ySize;
  for (int y = 0; y < height; ++y) {
    const uint8_t* row = bgra + static_cast<size_t>(y) * static_cast<size_t>(stride);
    for (int x = 0; x < width; ++x) {
      const int b = row[x * 4 + 0];
      const int g = row[x * 4 + 1];
      const int r = row[x * 4 + 2];
      yPlane[y * width + x] = ClampByte(((66 * r + 129 * g + 25 * b + 128) >> 8) + 16);
    }
  }
  for (int y = 0; y < height; y += 2) {
    const uint8_t* row0 = bgra + static_cast<size_t>(y) * static_cast<size_t>(stride);
    const uint8_t* row1 = bgra + static_cast<size_t>(y + 1) * static_cast<size_t>(stride);
    for (int x = 0; x < width; x += 2) {
      int r = 0;
      int g = 0;
      int b = 0;
      const uint8_t* samples[4] = {row0 + x * 4, row0 + (x + 1) * 4, row1 + x * 4, row1 + (x + 1) * 4};
      for (const uint8_t* sample : samples) {
        b += sample[0];
        g += sample[1];
        r += sample[2];
      }
      r /= 4;
      g /= 4;
      b /= 4;
      const int u = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
      const int v = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
      uint8_t* uv = uvPlane + static_cast<size_t>(y / 2) * static_cast<size_t>(width) + static_cast<size_t>(x);
      uv[0] = ClampByte(u);
      uv[1] = ClampByte(v);
    }
  }
}

bool SetUInt32(ICodecAPI* codec, const GUID& key, UINT32 value) {
  if (!codec) return false;
  VARIANT variant;
  VariantInit(&variant);
  variant.vt = VT_UI4;
  variant.ulVal = value;
  const HRESULT hr = codec->SetValue(&key, &variant);
  VariantClear(&variant);
  return SUCCEEDED(hr);
}

bool SetBool(ICodecAPI* codec, const GUID& key, bool value) {
  if (!codec) return false;
  VARIANT variant;
  VariantInit(&variant);
  variant.vt = VT_BOOL;
  variant.boolVal = value ? VARIANT_TRUE : VARIANT_FALSE;
  const HRESULT hr = codec->SetValue(&key, &variant);
  VariantClear(&variant);
  return SUCCEEDED(hr);
}

void AppendStartCode(std::vector<uint8_t>& out) {
  const uint8_t code[4] = {0, 0, 0, 1};
  out.insert(out.end(), code, code + 4);
}

bool LooksLikeAnnexB(const uint8_t* data, DWORD size) {
  if (size >= 4 && data[0] == 0 && data[1] == 0 && (data[2] == 1 || (data[2] == 0 && data[3] == 1))) return true;
  return false;
}

void AppendLengthPrefixed(const uint8_t* data, DWORD size, std::vector<uint8_t>& out) {
  DWORD offset = 0;
  while (offset + 4 <= size) {
    const uint32_t nalLength = (static_cast<uint32_t>(data[offset]) << 24) | (static_cast<uint32_t>(data[offset + 1]) << 16) |
                               (static_cast<uint32_t>(data[offset + 2]) << 8) | static_cast<uint32_t>(data[offset + 3]);
    offset += 4;
    if (nalLength == 0 || offset + nalLength > size) break;
    AppendStartCode(out);
    out.insert(out.end(), data + offset, data + offset + nalLength);
    offset += nalLength;
  }
}

bool ContainsNalType(const std::vector<uint8_t>& annexb, int type) {
  for (size_t i = 0; i + 4 < annexb.size(); ++i) {
    size_t payload = 0;
    if (annexb[i] == 0 && annexb[i + 1] == 0 && annexb[i + 2] == 1) payload = i + 3;
    else if (annexb[i] == 0 && annexb[i + 1] == 0 && annexb[i + 2] == 0 && annexb[i + 3] == 1) payload = i + 4;
    else continue;
    if (payload < annexb.size() && (annexb[payload] & 0x1f) == type) return true;
  }
  return false;
}

void ReleaseOutput(MFT_OUTPUT_DATA_BUFFER& output) {
  if (output.pSample) output.pSample->Release();
  if (output.pEvents) output.pEvents->Release();
  output.pSample = nullptr;
  output.pEvents = nullptr;
}

}  // namespace

H264Encoder::~H264Encoder() { Close(); }

void H264Encoder::Close() {
  if (transform_) {
    auto* transform = static_cast<IMFTransform*>(transform_);
    transform->ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
    transform->ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0);
    transform->Release();
    transform_ = nullptr;
  }
  if (mfStarted_) {
    MFShutdown();
    mfStarted_ = false;
  }
  active_ = false;
  width_ = 0;
  height_ = 0;
  frameIndex_ = 0;
  buffered_ = 0;
}

bool H264Encoder::Open(int width, int height, int bitrate, int fps, int gop, std::string& error) {
  Close();
  if (width < 2 || height < 2 || (width & 1) != 0 || (height & 1) != 0) {
    error = "H.264 encoder needs an even frame size";
    return false;
  }
  if (fps < 1) fps = 30;
  if (bitrate < 100000) bitrate = 8000000;
  if (gop < 1) gop = 60;

  const HRESULT started = MFStartup(MF_VERSION, MFSTARTUP_LITE);
  if (FAILED(started)) {
    error = HresultText("MFStartup", started);
    return false;
  }
  mfStarted_ = true;

  MFT_REGISTER_TYPE_INFO inputInfo = {MFMediaType_Video, MFVideoFormat_NV12};
  MFT_REGISTER_TYPE_INFO outputInfo = {MFMediaType_Video, MFVideoFormat_H264};
  IMFActivate** activates = nullptr;
  UINT32 count = 0;
  HRESULT hr = MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER,
                         MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_LOCALMFT | MFT_ENUM_FLAG_SORTANDFILTER, &inputInfo,
                         &outputInfo, &activates, &count);
  if (FAILED(hr) || count == 0) {
    if (activates) {
      for (UINT32 i = 0; i < count; ++i) {
        if (activates[i]) activates[i]->Release();
      }
      CoTaskMemFree(activates);
      activates = nullptr;
      count = 0;
    }
    hr = MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER,
                   MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_LOCALMFT | MFT_ENUM_FLAG_SORTANDFILTER, nullptr, &outputInfo,
                   &activates, &count);
  }
  if (FAILED(hr) || count == 0 || !activates) {
    error = FAILED(hr) ? HresultText("MFTEnumEx", hr) : "no synchronous H.264 encoder MFT";
    Close();
    return false;
  }

  ComPtr<IMFTransform> transform;
  for (UINT32 i = 0; i < count; ++i) {
    if (!transform && activates[i]) {
      WCHAR* friendly = nullptr;
      UINT32 friendlyLength = 0;
      std::string candidate = "H.264 encoder";
      if (SUCCEEDED(activates[i]->GetAllocatedString(MFT_FRIENDLY_NAME_Attribute, &friendly, &friendlyLength)) && friendly) {
        candidate = WideToUtf8(friendly);
        CoTaskMemFree(friendly);
      }
      ComPtr<IMFTransform> activated;
      if (SUCCEEDED(activates[i]->ActivateObject(IID_PPV_ARGS(&activated))) && activated) {
        ComPtr<IMFAttributes> attributes;
        UINT32 async = 0;
        if (SUCCEEDED(activated->GetAttributes(&attributes)) && attributes &&
            SUCCEEDED(attributes->GetUINT32(MF_TRANSFORM_ASYNC, &async)) && async != 0) {
          activated.Reset();
        } else {
          transform = activated;
          name_ = candidate;
        }
      }
    }
    activates[i]->Release();
  }
  CoTaskMemFree(activates);
  if (!transform) {
    error = "synchronous H.264 MFT would not activate";
    Close();
    return false;
  }

  ComPtr<IMFMediaType> outType;
  MFCreateMediaType(&outType);
  outType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
  outType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
  MFSetAttributeSize(outType.Get(), MF_MT_FRAME_SIZE, static_cast<UINT32>(width), static_cast<UINT32>(height));
  MFSetAttributeRatio(outType.Get(), MF_MT_FRAME_RATE, static_cast<UINT32>(fps), 1);
  MFSetAttributeRatio(outType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
  outType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
  outType->SetUINT32(MF_MT_AVG_BITRATE, static_cast<UINT32>(bitrate));
  outType->SetUINT32(MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Base);

  ComPtr<IMFMediaType> inType;
  MFCreateMediaType(&inType);
  inType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
  inType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12);
  MFSetAttributeSize(inType.Get(), MF_MT_FRAME_SIZE, static_cast<UINT32>(width), static_cast<UINT32>(height));
  MFSetAttributeRatio(inType.Get(), MF_MT_FRAME_RATE, static_cast<UINT32>(fps), 1);
  MFSetAttributeRatio(inType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
  inType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);

  hr = transform->SetOutputType(0, outType.Get(), 0);
  if (SUCCEEDED(hr)) hr = transform->SetInputType(0, inType.Get(), 0);
  if (FAILED(hr)) {
    hr = transform->SetInputType(0, inType.Get(), 0);
    if (SUCCEEDED(hr)) hr = transform->SetOutputType(0, outType.Get(), 0);
  }
  if (FAILED(hr)) {
    error = HresultText("SetInputType/SetOutputType", hr);
    Close();
    return false;
  }

  ComPtr<ICodecAPI> codec;
  transform.As(&codec);
  SetUInt32(codec.Get(), CODECAPI_AVEncCommonRateControlMode, eAVEncCommonRateControlMode_CBR);
  SetUInt32(codec.Get(), CODECAPI_AVEncCommonMeanBitRate, static_cast<UINT32>(bitrate));
  SetUInt32(codec.Get(), CODECAPI_AVEncMPVGOPSize, static_cast<UINT32>(gop));
  // The output media type already carries MF_MT_MPEG2_PROFILE. This GUID is not
  // in every Windows SDK's codecapi.h, so only set it when the header defines it.
#ifdef CODECAPI_AVEncH264VProfile
  SetUInt32(codec.Get(), CODECAPI_AVEncH264VProfile, eAVEncH264VProfile_Base);
#endif
  SetBool(codec.Get(), CODECAPI_AVLowLatencyMode, true);

  transform->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
  transform->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
  transform->AddRef();
  transform_ = transform.Get();
  width_ = width;
  height_ = height;
  bitrate_ = bitrate;
  fps_ = fps;
  gop_ = gop;
  active_ = true;
  std::fprintf(stderr, "[dxgi] h264 encoder %s %dx%d\n", name_.c_str(), width, height);
  return true;
}

H264EncodeStatus H264Encoder::Encode(const uint8_t* bgra, int width, int height, int stride, bool& keyframe,
                                     std::vector<uint8_t>& annexb) {
  keyframe = false;
  annexb.clear();
  if (!active_ || !transform_ || !bgra) return H264EncodeStatus::Failed;
  if (width != width_ || height != height_) {
    std::string error;
    if (!Open(width, height, bitrate_, fps_, gop_, error)) return H264EncodeStatus::Failed;
  }
  auto* transform = static_cast<IMFTransform*>(transform_);

  std::vector<uint8_t> nv12;
  BgraToNv12(bgra, width, height, stride, nv12);

  ComPtr<IMFSample> sample;
  ComPtr<IMFMediaBuffer> buffer;
  if (FAILED(MFCreateSample(&sample)) ||
      FAILED(MFCreateAlignedMemoryBuffer(static_cast<DWORD>(nv12.size()), MF_16_BYTE_ALIGNMENT, &buffer))) {
    return H264EncodeStatus::Failed;
  }
  BYTE* dest = nullptr;
  DWORD maxLength = 0;
  if (FAILED(buffer->Lock(&dest, &maxLength, nullptr)) || !dest || maxLength < nv12.size()) {
    return H264EncodeStatus::Failed;
  }
  std::memcpy(dest, nv12.data(), nv12.size());
  buffer->Unlock();
  buffer->SetCurrentLength(static_cast<DWORD>(nv12.size()));
  sample->AddBuffer(buffer.Get());
  const LONGLONG duration = 10'000'000LL / fps_;
  sample->SetSampleTime(frameIndex_ * duration);
  sample->SetSampleDuration(duration);
  if (frameIndex_ % gop_ == 0) {
    ComPtr<ICodecAPI> codec;
    transform->QueryInterface(IID_PPV_ARGS(&codec));
    SetUInt32(codec.Get(), CODECAPI_AVEncVideoForceKeyFrame, 1);
  }

  HRESULT hr = transform->ProcessInput(0, sample.Get(), 0);
  if (hr == MF_E_NOTACCEPTING) {
    bool ignored = false;
    std::vector<uint8_t> drained;
    Drain(ignored, drained);
    if (!drained.empty()) annexb = std::move(drained);
    hr = transform->ProcessInput(0, sample.Get(), 0);
  }
  if (FAILED(hr)) {
    active_ = false;
    return H264EncodeStatus::Failed;
  }
  frameIndex_ += 1;

  bool producedKeyframe = false;
  std::vector<uint8_t> produced;
  const bool drained = Drain(producedKeyframe, produced);
  if (!annexb.empty() && !produced.empty()) {
    annexb.insert(annexb.end(), produced.begin(), produced.end());
  } else if (!produced.empty()) {
    annexb = std::move(produced);
  }
  if (!drained && annexb.empty()) {
    buffered_ += 1;
    if (buffered_ > 8) {
      active_ = false;
      return H264EncodeStatus::Failed;
    }
    return H264EncodeStatus::NeedMore;
  }
  buffered_ = 0;
  keyframe = producedKeyframe || ContainsNalType(annexb, 5);
  if (keyframe) PrependSequenceHeader(annexb);
  return annexb.empty() ? H264EncodeStatus::NeedMore : H264EncodeStatus::Frame;
}

bool H264Encoder::Drain(bool& keyframe, std::vector<uint8_t>& annexb) {
  auto* transform = static_cast<IMFTransform*>(transform_);
  if (!transform) return false;
  bool any = false;
  for (int attempt = 0; attempt < 8; ++attempt) {
    MFT_OUTPUT_STREAM_INFO streamInfo = {};
    if (FAILED(transform->GetOutputStreamInfo(0, &streamInfo))) return any;

    MFT_OUTPUT_DATA_BUFFER output = {};
    ComPtr<IMFSample> owned;
    const bool providesSamples =
        (streamInfo.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES)) != 0;
    if (!providesSamples) {
      if (FAILED(MFCreateSample(&owned))) return any;
      ComPtr<IMFMediaBuffer> memory;
      DWORD bytes = streamInfo.cbSize > 0 ? streamInfo.cbSize : static_cast<DWORD>(width_ * height_);
      if (FAILED(MFCreateAlignedMemoryBuffer(bytes, MF_16_BYTE_ALIGNMENT, &memory))) return any;
      owned->AddBuffer(memory.Get());
      output.pSample = owned.Get();
      output.pSample->AddRef();
    }

    DWORD status = 0;
    const HRESULT hr = transform->ProcessOutput(0, 1, &output, &status);
    if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT) {
      ReleaseOutput(output);
      return any;
    }
    if (hr == MF_E_TRANSFORM_STREAM_CHANGE) {
      ReleaseOutput(output);
      ComPtr<IMFMediaType> updated;
      if (FAILED(transform->GetOutputAvailableType(0, 0, &updated)) || FAILED(transform->SetOutputType(0, updated.Get(), 0))) {
        return any;
      }
      continue;
    }
    if (FAILED(hr) || !output.pSample) {
      ReleaseOutput(output);
      active_ = false;
      return any;
    }

    UINT32 clean = 0;
    if (SUCCEEDED(output.pSample->GetUINT32(MFSampleExtension_CleanPoint, &clean)) && clean != 0) keyframe = true;
    ComPtr<IMFMediaBuffer> contiguous;
    if (SUCCEEDED(output.pSample->ConvertToContiguousBuffer(&contiguous)) && contiguous) {
      BYTE* data = nullptr;
      DWORD current = 0;
      if (SUCCEEDED(contiguous->Lock(&data, nullptr, &current)) && data && current > 0) {
        if (LooksLikeAnnexB(data, current)) annexb.insert(annexb.end(), data, data + current);
        else AppendLengthPrefixed(data, current, annexb);
        contiguous->Unlock();
        any = !annexb.empty();
      }
    }
    ReleaseOutput(output);
    if (any) return true;
  }
  return any;
}

void H264Encoder::PrependSequenceHeader(std::vector<uint8_t>& annexb) {
  if (ContainsNalType(annexb, 7) || !transform_) return;
  auto* transform = static_cast<IMFTransform*>(transform_);
  ComPtr<IMFMediaType> type;
  if (FAILED(transform->GetOutputCurrentType(0, &type)) || !type) return;
  UINT32 size = 0;
  if (FAILED(type->GetBlobSize(MF_MT_MPEG_SEQUENCE_HEADER, &size)) || size < 4) return;
  std::vector<uint8_t> header(size);
  if (FAILED(type->GetBlob(MF_MT_MPEG_SEQUENCE_HEADER, header.data(), size, &size))) return;
  header.resize(size);
  std::vector<uint8_t> prefix;
  if (LooksLikeAnnexB(header.data(), static_cast<DWORD>(header.size()))) prefix = std::move(header);
  else AppendLengthPrefixed(header.data(), static_cast<DWORD>(header.size()), prefix);
  if (prefix.empty()) return;
  prefix.insert(prefix.end(), annexb.begin(), annexb.end());
  annexb.swap(prefix);
}
