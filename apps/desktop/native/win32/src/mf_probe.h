#pragma once

#include <string>
#include <vector>

struct H264EncoderInfo {
  std::string name;
  std::string clsid;
  bool hardware = false;
};

struct H264Probe {
  bool available = false;
  std::string error;
  std::vector<H264EncoderInfo> encoders;
};

// Enumerates Media Foundation H.264 encoder MFTs. Does not create a sample
// or call ProcessInput — that is the next encode step.
H264Probe ProbeH264Encoders();
