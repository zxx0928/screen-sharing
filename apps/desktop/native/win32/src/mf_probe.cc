#include "mf_probe.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mftransform.h>
#include <mferror.h>

#include <cstdio>

namespace {

std::string WideToUtf8(const wchar_t* value) {
  if (!value || value[0] == L'\0') return {};
  const int bytes = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
  if (bytes <= 1) return {};
  std::string out(static_cast<size_t>(bytes - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value, -1, out.data(), bytes, nullptr, nullptr);
  return out;
}

std::string ClsidToString(const CLSID& clsid) {
  LPOLESTR text = nullptr;
  if (FAILED(StringFromCLSID(clsid, &text)) || !text) return {};
  std::string utf8 = WideToUtf8(text);
  CoTaskMemFree(text);
  return utf8;
}

std::string HresultText(const char* where, HRESULT hr) {
  char buffer[160];
  std::snprintf(buffer, sizeof(buffer), "%s failed (0x%08lX)", where, static_cast<unsigned long>(hr));
  return buffer;
}

class ComApartment {
 public:
  ComApartment() {
    const HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    uninit_ = hr == S_OK || hr == S_FALSE;
  }
  ~ComApartment() {
    if (uninit_) CoUninitialize();
  }
  ComApartment(const ComApartment&) = delete;
  ComApartment& operator=(const ComApartment&) = delete;

 private:
  bool uninit_ = false;
};

}  // namespace

H264Probe ProbeH264Encoders() {
  H264Probe probe;
  ComApartment com;
  const HRESULT startup = MFStartup(MF_VERSION, MFSTARTUP_LITE);
  if (FAILED(startup)) {
    probe.error = HresultText("MFStartup", startup);
    return probe;
  }

  IMFActivate** activates = nullptr;
  UINT32 count = 0;
  MFT_REGISTER_TYPE_INFO outputType = {MFMediaType_Video, MFVideoFormat_H264};
  const HRESULT listed = MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER,
                                   MFT_ENUM_FLAG_SORTANDFILTER | MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_ASYNCMFT |
                                       MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_LOCALMFT,
                                   nullptr, &outputType, &activates, &count);
  if (FAILED(listed)) {
    probe.error = HresultText("MFTEnumEx", listed);
    MFShutdown();
    return probe;
  }

  const UINT32 limit = count > 8 ? 8 : count;
  for (UINT32 i = 0; i < count; ++i) {
    if (i < limit && activates[i]) {
      H264EncoderInfo info;
      WCHAR* name = nullptr;
      UINT32 nameLength = 0;
      if (SUCCEEDED(activates[i]->GetAllocatedString(MFT_FRIENDLY_NAME_Attribute, &name, &nameLength)) && name) {
        info.name = WideToUtf8(name);
        CoTaskMemFree(name);
      }
      if (info.name.empty()) info.name = "H.264 encoder";

      CLSID clsid = {};
      if (SUCCEEDED(activates[i]->GetGUID(MFT_TRANSFORM_CLSID_Attribute, &clsid))) {
        info.clsid = ClsidToString(clsid);
      }

      WCHAR* hardwareUrl = nullptr;
      UINT32 hardwareLength = 0;
      if (SUCCEEDED(activates[i]->GetAllocatedString(MFT_ENUM_HARDWARE_URL_Attribute, &hardwareUrl, &hardwareLength)) &&
          hardwareUrl) {
        info.hardware = hardwareUrl[0] != L'\0';
        CoTaskMemFree(hardwareUrl);
      }
      probe.encoders.push_back(std::move(info));
    }
    if (activates[i]) activates[i]->Release();
  }
  if (activates) CoTaskMemFree(activates);

  MFShutdown();
  probe.available = !probe.encoders.empty();
  if (!probe.available) probe.error = "no H.264 encoder MFT";
  return probe;
}
