#include "dxgi_capture.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wincodec.h>
#include <wrl/client.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {

constexpr int kDefaultMaxWidth = 1920;
constexpr int kMaxDimension = 3840;
constexpr long long kMaxPixels = 3840LL * 3840LL;

std::string WideToUtf8(const wchar_t* value) {
  if (!value || value[0] == L'\0') return {};
  const int bytes = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
  if (bytes <= 1) return {};
  std::string out(static_cast<size_t>(bytes - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value, -1, out.data(), bytes, nullptr, nullptr);
  return out;
}

std::string HresultText(const char* where, HRESULT hr) {
  char buffer[160];
  std::snprintf(buffer, sizeof(buffer), "%s failed (0x%08lX)", where, static_cast<unsigned long>(hr));
  return buffer;
}

class ComApartment {
 public:
  ComApartment() {
    const HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
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

struct OutputTarget {
  ComPtr<IDXGIAdapter1> adapter;
  ComPtr<IDXGIOutput1> output;
  DxgiDisplay info;
};

bool DescribeOutput(IDXGIOutput* output, DxgiDisplay& info) {
  DXGI_OUTPUT_DESC desc = {};
  if (FAILED(output->GetDesc(&desc))) return false;
  if (!desc.AttachedToDesktop) return false;
  info.originX = desc.DesktopCoordinates.left;
  info.originY = desc.DesktopCoordinates.top;
  info.width = desc.DesktopCoordinates.right - desc.DesktopCoordinates.left;
  info.height = desc.DesktopCoordinates.bottom - desc.DesktopCoordinates.top;
  if (info.width < 2 || info.height < 2) return false;
  info.primary = false;
  if (desc.Monitor) {
    MONITORINFO monitor = {};
    monitor.cbSize = sizeof(monitor);
    if (GetMonitorInfoW(desc.Monitor, &monitor)) {
      info.primary = (monitor.dwFlags & MONITORINFOF_PRIMARY) != 0;
    }
  }
  info.name = WideToUtf8(desc.DeviceName);
  return true;
}

bool EnumerateAdapters(std::vector<OutputTarget>& hardware, std::vector<OutputTarget>& software, std::string& error) {
  ComPtr<IDXGIFactory1> factory;
  const HRESULT created = CreateDXGIFactory1(IID_PPV_ARGS(&factory));
  if (FAILED(created)) {
    error = HresultText("CreateDXGIFactory1", created);
    return false;
  }

  for (UINT adapterIndex = 0;; ++adapterIndex) {
    ComPtr<IDXGIAdapter1> adapter;
    const HRESULT nextAdapter = factory->EnumAdapters1(adapterIndex, &adapter);
    if (nextAdapter == DXGI_ERROR_NOT_FOUND) break;
    if (FAILED(nextAdapter)) continue;

    DXGI_ADAPTER_DESC1 adapterDesc = {};
    adapter->GetDesc1(&adapterDesc);
    const bool isSoftware = (adapterDesc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) != 0;

    for (UINT outputIndex = 0;; ++outputIndex) {
      ComPtr<IDXGIOutput> output;
      const HRESULT nextOutput = adapter->EnumOutputs(outputIndex, &output);
      if (nextOutput == DXGI_ERROR_NOT_FOUND) break;
      if (FAILED(nextOutput)) continue;
      ComPtr<IDXGIOutput1> output1;
      if (FAILED(output.As(&output1))) continue;
      OutputTarget target;
      if (!DescribeOutput(output.Get(), target.info)) continue;
      target.adapter = adapter;
      target.output = output1;
      if (isSoftware) software.push_back(std::move(target));
      else hardware.push_back(std::move(target));
    }
  }
  return true;
}

std::vector<OutputTarget> ListOutputs(std::string& error) {
  std::vector<OutputTarget> hardware;
  std::vector<OutputTarget> software;
  if (!EnumerateAdapters(hardware, software, error)) return {};
  std::vector<OutputTarget>& chosen = hardware.empty() ? software : hardware;
  for (size_t i = 0; i < chosen.size(); ++i) chosen[i].info.index = static_cast<int>(i);
  return std::move(chosen);
}

void UnionVirtualScreen(const std::vector<OutputTarget>& outputs, DxgiLayout& layout) {
  if (outputs.empty()) return;
  int left = outputs[0].info.originX;
  int top = outputs[0].info.originY;
  int right = left + outputs[0].info.width;
  int bottom = top + outputs[0].info.height;
  for (size_t i = 1; i < outputs.size(); ++i) {
    const DxgiDisplay& display = outputs[i].info;
    if (display.originX < left) left = display.originX;
    if (display.originY < top) top = display.originY;
    if (display.originX + display.width > right) right = display.originX + display.width;
    if (display.originY + display.height > bottom) bottom = display.originY + display.height;
  }
  layout.virtualLeft = left;
  layout.virtualTop = top;
  layout.virtualWidth = right - left;
  layout.virtualHeight = bottom - top;
}

// Same arithmetic as fitEvenFrame() in frame-size.ts.
bool FitEven(int srcWidth, int srcHeight, int maxWidth, int& dstWidth, int& dstHeight) {
  if (srcWidth < 2 || srcHeight < 2 || maxWidth < 2) return false;
  int width = srcWidth;
  int height = srcHeight;
  if (width > maxWidth) {
    height = static_cast<int>((static_cast<long long>(height) * maxWidth) / width);
    width = maxWidth;
  }
  if (width < 2) width = 2;
  if (height < 2) height = 2;
  width &= ~1;
  height &= ~1;
  if (width < 2 || height < 2) return false;
  dstWidth = width;
  dstHeight = height;
  return true;
}

void ScaleBgraNearest(const uint8_t* src, int srcWidth, int srcHeight, int srcStride, int dstWidth, int dstHeight,
                      std::vector<uint8_t>& dst) {
  dst.resize(static_cast<size_t>(dstWidth) * static_cast<size_t>(dstHeight) * 4);
  for (int y = 0; y < dstHeight; ++y) {
    const int srcY = y * srcHeight / dstHeight;
    const uint8_t* row = src + static_cast<size_t>(srcY) * static_cast<size_t>(srcStride);
    uint8_t* out = dst.data() + static_cast<size_t>(y) * static_cast<size_t>(dstWidth) * 4;
    for (int x = 0; x < dstWidth; ++x) {
      const int srcX = x * srcWidth / dstWidth;
      std::memcpy(out + static_cast<size_t>(x) * 4, row + static_cast<size_t>(srcX) * 4, 4);
    }
  }
}

bool EncodeJpeg(IWICImagingFactory* factory, const uint8_t* bgra, int width, int height, int stride,
                std::vector<uint8_t>& jpeg) {
  if (!factory || !bgra || width < 2 || height < 2 || stride < width * 4) return false;
  if (static_cast<long long>(width) * height > kMaxPixels) return false;
  const UINT bufferSize = static_cast<UINT>(stride) * static_cast<UINT>(height);

  ComPtr<IWICBitmap> bitmap;
  HRESULT hr = factory->CreateBitmapFromMemory(static_cast<UINT>(width), static_cast<UINT>(height),
                                                GUID_WICPixelFormat32bppBGRA, static_cast<UINT>(stride), bufferSize,
                                                const_cast<BYTE*>(bgra), &bitmap);
  if (FAILED(hr)) return false;

  ComPtr<IStream> stream;
  hr = CreateStreamOnHGlobal(nullptr, TRUE, &stream);
  if (FAILED(hr)) return false;

  ComPtr<IWICBitmapEncoder> encoder;
  hr = factory->CreateEncoder(GUID_ContainerFormatJpeg, nullptr, &encoder);
  if (FAILED(hr)) return false;
  hr = encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache);
  if (FAILED(hr)) return false;

  ComPtr<IWICBitmapFrameEncode> frame;
  ComPtr<IPropertyBag2> props;
  hr = encoder->CreateNewFrame(&frame, &props);
  if (FAILED(hr)) return false;
  if (props) {
    PROPBAG2 option = {};
    option.pstrName = const_cast<LPOLESTR>(L"ImageQuality");
    VARIANT quality;
    VariantInit(&quality);
    quality.vt = VT_R4;
    quality.fltVal = 0.72f;
    props->Write(1, &option, &quality);
    VariantClear(&quality);
  }
  hr = frame->Initialize(props.Get());
  if (FAILED(hr)) return false;
  hr = frame->SetSize(static_cast<UINT>(width), static_cast<UINT>(height));
  if (FAILED(hr)) return false;

  WICPixelFormatGUID format = GUID_WICPixelFormat24bppBGR;
  hr = frame->SetPixelFormat(&format);
  if (FAILED(hr)) return false;

  ComPtr<IWICFormatConverter> converter;
  hr = factory->CreateFormatConverter(&converter);
  if (FAILED(hr)) return false;
  hr = converter->Initialize(bitmap.Get(), format, WICBitmapDitherTypeNone, nullptr, 0.0, WICBitmapPaletteTypeCustom);
  if (FAILED(hr)) return false;
  hr = frame->WriteSource(converter.Get(), nullptr);
  if (FAILED(hr)) return false;
  hr = frame->Commit();
  if (FAILED(hr)) return false;
  hr = encoder->Commit();
  if (FAILED(hr)) return false;

  STATSTG stat = {};
  hr = stream->Stat(&stat, STATFLAG_NONAME);
  if (FAILED(hr) || stat.cbSize.QuadPart < 4 || stat.cbSize.QuadPart > 8u * 1024u * 1024u) return false;
  jpeg.resize(static_cast<size_t>(stat.cbSize.QuadPart));
  LARGE_INTEGER zero = {};
  hr = stream->Seek(zero, STREAM_SEEK_SET, nullptr);
  if (FAILED(hr)) return false;
  ULONG read = 0;
  hr = stream->Read(jpeg.data(), static_cast<ULONG>(jpeg.size()), &read);
  if (FAILED(hr) || read < 4) return false;
  jpeg.resize(read);
  return jpeg[0] == 0xff && jpeg[1] == 0xd8;
}

struct DeviceBundle {
  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11DeviceContext> context;
  ComPtr<IDXGIOutputDuplication> duplication;
  ComPtr<ID3D11Texture2D> staging;
  int stagingWidth = 0;
  int stagingHeight = 0;
  DxgiDisplay display;
};

bool CreateDeviceFor(const OutputTarget& target, DeviceBundle& bundle, std::string& error) {
  const UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
  D3D_FEATURE_LEVEL level = D3D_FEATURE_LEVEL_11_0;
  const HRESULT created = D3D11CreateDevice(target.adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr, flags, nullptr, 0,
                                            D3D11_SDK_VERSION, &bundle.device, &level, &bundle.context);
  if (FAILED(created)) {
    error = HresultText("D3D11CreateDevice", created);
    return false;
  }
  ComPtr<ID3D11Multithread> multithread;
  if (SUCCEEDED(bundle.device.As(&multithread)) && multithread) multithread->SetMultithreadProtected(TRUE);

  const HRESULT duplicated = target.output->DuplicateOutput(bundle.device.Get(), &bundle.duplication);
  if (FAILED(duplicated)) {
    error = HresultText("DuplicateOutput", duplicated);
    bundle.device.Reset();
    bundle.context.Reset();
    return false;
  }
  bundle.display = target.info;
  return true;
}

bool EnsureStaging(DeviceBundle& bundle, const D3D11_TEXTURE2D_DESC& source) {
  if (bundle.staging && bundle.stagingWidth == static_cast<int>(source.Width) &&
      bundle.stagingHeight == static_cast<int>(source.Height)) {
    return true;
  }
  D3D11_TEXTURE2D_DESC desc = source;
  desc.Usage = D3D11_USAGE_STAGING;
  desc.BindFlags = 0;
  desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  desc.MiscFlags = 0;
  desc.MipLevels = 1;
  desc.ArraySize = 1;
  desc.SampleDesc.Count = 1;
  desc.SampleDesc.Quality = 0;
  bundle.staging.Reset();
  const HRESULT hr = bundle.device->CreateTexture2D(&desc, nullptr, &bundle.staging);
  if (FAILED(hr)) return false;
  bundle.stagingWidth = static_cast<int>(source.Width);
  bundle.stagingHeight = static_cast<int>(source.Height);
  return true;
}

struct StartGate {
  std::mutex mu;
  std::condition_variable cv;
  bool done = false;
  DxgiStart result;

  void Finish(DxgiStart value) {
    {
      std::lock_guard<std::mutex> lock(mu);
      if (done) return;
      result = std::move(value);
      done = true;
    }
    cv.notify_one();
  }
};

class CaptureService {
 public:
  ~CaptureService() { Stop(); }

  DxgiStart Start(int displayIndex, int maxFrameWidth) {
    std::lock_guard<std::mutex> lock(controlMu_);
    StopUnlocked();
    const int capped = maxFrameWidth >= 2 && maxFrameWidth <= kMaxDimension ? maxFrameWidth : kDefaultMaxWidth;
    stop_.store(false);
    auto gate = std::make_shared<StartGate>();
    thread_ = std::thread([this, gate, displayIndex, capped] { ThreadMain(gate, displayIndex, capped); });

    DxgiStart result;
    {
      std::unique_lock<std::mutex> gateLock(gate->mu);
      gate->cv.wait_for(gateLock, std::chrono::seconds(3), [&] { return gate->done; });
      result = gate->result;
    }
    if (!gate->done || !result.ok) {
      stop_.store(true);
      if (thread_.joinable()) thread_.join();
      if (!gate->done) {
        result.ok = false;
        result.error = "DXGI capture timed out during startup";
      }
    }
    return result;
  }

  void Stop() {
    std::lock_guard<std::mutex> lock(controlMu_);
    StopUnlocked();
  }

  bool CopyFrame(uint64_t since, DxgiJpegFrame& out) {
    std::lock_guard<std::mutex> lock(frameMu_);
    if (latest_.frameId == 0 || latest_.frameId <= since || latest_.jpeg.empty()) return false;
    out = latest_;
    return true;
  }

 private:
  void StopUnlocked() {
    stop_.store(true);
    if (thread_.joinable()) thread_.join();
    std::lock_guard<std::mutex> lock(frameMu_);
    latest_ = {};
  }

  void ThreadMain(const std::shared_ptr<StartGate>& gate, int displayIndex, int maxFrameWidth) {
    try {
      ComApartment com;
      std::string error;
      const std::vector<OutputTarget> outputs = ListOutputs(error);
      if (outputs.empty()) {
        DxgiStart failed;
        failed.error = error.empty() ? "no attached DXGI outputs" : error;
        gate->Finish(std::move(failed));
        return;
      }
      if (displayIndex < 0 || displayIndex >= static_cast<int>(outputs.size())) {
        DxgiStart failed;
        failed.error = "display index is out of range";
        gate->Finish(std::move(failed));
        return;
      }

      DeviceBundle bundle;
      if (!CreateDeviceFor(outputs[static_cast<size_t>(displayIndex)], bundle, error)) {
        DxgiStart failed;
        failed.error = error.empty() ? "DuplicateOutput failed" : error;
        gate->Finish(std::move(failed));
        return;
      }

      int frameWidth = 0;
      int frameHeight = 0;
      if (!FitEven(bundle.display.width, bundle.display.height, maxFrameWidth, frameWidth, frameHeight)) {
        DxgiStart failed;
        failed.error = "display size is not encodable";
        gate->Finish(std::move(failed));
        return;
      }

      ComPtr<IWICImagingFactory> factory;
      const HRESULT wic = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory));
      if (FAILED(wic)) {
        DxgiStart failed;
        failed.error = HresultText("CoCreateInstance(WIC)", wic);
        gate->Finish(std::move(failed));
        return;
      }

      DxgiStart started;
      started.ok = true;
      started.originX = bundle.display.originX;
      started.originY = bundle.display.originY;
      started.captureWidth = bundle.display.width;
      started.captureHeight = bundle.display.height;
      started.frameWidth = frameWidth;
      started.frameHeight = frameHeight;
      gate->Finish(started);
      CaptureLoop(bundle, factory.Get(), maxFrameWidth, displayIndex);
    } catch (const std::exception& ex) {
      std::fprintf(stderr, "[dxgi] capture thread exception: %s\n", ex.what());
      DxgiStart failed;
      failed.error = ex.what();
      gate->Finish(std::move(failed));
    }
  }

  void CaptureLoop(DeviceBundle& bundle, IWICImagingFactory* factory, int maxFrameWidth, int displayIndex) {
    uint64_t nextId = 1;
    while (!stop_.load()) {
      if (!bundle.duplication) {
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
        std::string error;
        const std::vector<OutputTarget> outputs = ListOutputs(error);
        if (displayIndex >= 0 && displayIndex < static_cast<int>(outputs.size())) {
          bundle.duplication.Reset();
          bundle.device.Reset();
          bundle.context.Reset();
          bundle.staging.Reset();
          bundle.stagingWidth = 0;
          bundle.stagingHeight = 0;
          CreateDeviceFor(outputs[static_cast<size_t>(displayIndex)], bundle, error);
        }
        continue;
      }

      DXGI_OUTDUPL_FRAME_INFO info = {};
      ComPtr<IDXGIResource> resource;
      const HRESULT acquired = bundle.duplication->AcquireNextFrame(50, &info, &resource);
      if (acquired == DXGI_ERROR_WAIT_TIMEOUT) {
        (void)info;
        continue;
      }
      if (acquired == DXGI_ERROR_ACCESS_LOST || acquired == DXGI_ERROR_DEVICE_REMOVED ||
          acquired == DXGI_ERROR_DEVICE_RESET) {
        bundle.duplication.Reset();
        bundle.device.Reset();
        bundle.context.Reset();
        bundle.staging.Reset();
        continue;
      }
      if (FAILED(acquired) || !resource) continue;

      Publish(bundle, resource.Get(), factory, maxFrameWidth, nextId);
      bundle.duplication->ReleaseFrame();
    }
  }

  void Publish(DeviceBundle& bundle, IDXGIResource* resource, IWICImagingFactory* factory, int maxFrameWidth,
               uint64_t& nextId) {
    ComPtr<ID3D11Texture2D> texture;
    if (FAILED(resource->QueryInterface(IID_PPV_ARGS(&texture)))) return;
    D3D11_TEXTURE2D_DESC desc = {};
    texture->GetDesc(&desc);
    if (desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM && desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM_SRGB) return;
    if (!EnsureStaging(bundle, desc)) return;
    bundle.context->CopyResource(bundle.staging.Get(), texture.Get());

    D3D11_MAPPED_SUBRESOURCE mapped = {};
    if (FAILED(bundle.context->Map(bundle.staging.Get(), 0, D3D11_MAP_READ, 0, &mapped))) return;
    const int width = static_cast<int>(desc.Width);
    const int height = static_cast<int>(desc.Height);
    const int stride = static_cast<int>(mapped.RowPitch);
    std::vector<uint8_t> jpeg;
    bool encoded = false;
    if (mapped.pData && stride >= width * 4 && width >= 2 && height >= 2) {
      int frameWidth = 0;
      int frameHeight = 0;
      const uint8_t* pixels = static_cast<const uint8_t*>(mapped.pData);
      if (FitEven(width, height, maxFrameWidth, frameWidth, frameHeight) &&
          (frameWidth != width || frameHeight != height)) {
        std::vector<uint8_t> scaled;
        ScaleBgraNearest(pixels, width, height, stride, frameWidth, frameHeight, scaled);
        encoded = EncodeJpeg(factory, scaled.data(), frameWidth, frameHeight, frameWidth * 4, jpeg);
      } else if (stride == width * 4) {
        encoded = EncodeJpeg(factory, pixels, width, height, stride, jpeg);
      } else {
        std::vector<uint8_t> packed(static_cast<size_t>(width) * static_cast<size_t>(height) * 4);
        for (int y = 0; y < height; ++y) {
          std::memcpy(packed.data() + static_cast<size_t>(y) * static_cast<size_t>(width) * 4,
                      pixels + static_cast<size_t>(y) * static_cast<size_t>(stride), static_cast<size_t>(width) * 4);
        }
        encoded = EncodeJpeg(factory, packed.data(), width, height, width * 4, jpeg);
      }
    }
    bundle.context->Unmap(bundle.staging.Get(), 0);
    if (!encoded) return;

    DxgiJpegFrame frame;
    frame.frameId = nextId++;
    frame.width = 0;
    frame.height = 0;
    frame.originX = bundle.display.originX;
    frame.originY = bundle.display.originY;
    // Width/height describe the JPEG, which FitEven already applied.
    // Re-read from the encode inputs by parsing is unnecessary: jpeg is the
    // scaled image, and the renderer resizes the canvas to these fields.
    // Store them by decoding the scale decision again from the texture size.
    int frameWidth = 0;
    int frameHeight = 0;
    if (!FitEven(width, height, maxFrameWidth, frameWidth, frameHeight)) return;
    frame.width = frameWidth;
    frame.height = frameHeight;
    frame.jpeg = std::move(jpeg);
    std::lock_guard<std::mutex> lock(frameMu_);
    latest_ = std::move(frame);
  }

  std::mutex controlMu_;
  std::atomic<bool> stop_{true};
  std::thread thread_;
  std::mutex frameMu_;
  DxgiJpegFrame latest_;
};

std::mutex g_serviceMu;
CaptureService* g_service = nullptr;

CaptureService* CurrentService() {
  std::lock_guard<std::mutex> lock(g_serviceMu);
  if (!g_service) g_service = new CaptureService();
  return g_service;
}

}  // namespace

DxgiLayout QueryDesktopLayout() {
  DxgiLayout layout;
  const std::vector<OutputTarget> outputs = ListOutputs(layout.error);
  layout.displays.reserve(outputs.size());
  for (const OutputTarget& output : outputs) layout.displays.push_back(output.info);
  UnionVirtualScreen(outputs, layout);
  if (layout.displays.empty() && layout.error.empty()) layout.error = "no attached DXGI outputs";
  return layout;
}

DxgiStart StartDesktopCapture(int displayIndex, int maxFrameWidth) {
  CaptureService* service = CurrentService();
  return service->Start(displayIndex, maxFrameWidth);
}

void StopDesktopCapture() {
  CaptureService* service = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_serviceMu);
    service = g_service;
    g_service = nullptr;
  }
  delete service;
}

bool CopyLatestJpeg(uint64_t since, DxgiJpegFrame& out) {
  std::lock_guard<std::mutex> lock(g_serviceMu);
  if (!g_service) return false;
  return g_service->CopyFrame(since, out);
}
