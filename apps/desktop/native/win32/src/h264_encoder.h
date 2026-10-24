#pragma once

#include <cstdint>
#include <string>
#include <vector>

// Result of feeding one BGRA frame to the synchronous H.264 MFT.
enum class H264EncodeStatus {
  Frame,     // `annexb` holds one access unit
  NeedMore,  // encoder is healthy but buffered this input
  Failed,    // encoder is no longer usable
};

// CPU BGRA → NV12 → synchronous Media Foundation H.264 MFT → Annex-B.
// Hardware async MFTs are skipped. JPEG remains the fallback when Open fails.
class H264Encoder {
 public:
  ~H264Encoder();

  bool Open(int width, int height, int bitrate, int fps, int gop, std::string& error);
  void Close();

  bool active() const { return active_; }
  const std::string& name() const { return name_; }

  H264EncodeStatus Encode(const uint8_t* bgra, int width, int height, int stride, bool& keyframe,
                          std::vector<uint8_t>& annexb);

 private:
  bool Drain(bool& keyframe, std::vector<uint8_t>& annexb);
  void PrependSequenceHeader(std::vector<uint8_t>& annexb);

  bool active_ = false;
  bool mfStarted_ = false;
  int width_ = 0;
  int height_ = 0;
  int bitrate_ = 0;
  int fps_ = 30;
  int gop_ = 60;
  int buffered_ = 0;
  long long frameIndex_ = 0;
  std::string name_;
  // IMFTransform* stored as void* in the header so this file stays free of mfidl.h.
  void* transform_ = nullptr;
};
