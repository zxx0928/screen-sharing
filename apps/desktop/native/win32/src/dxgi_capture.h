#pragma once

#include <cstdint>
#include <string>
#include <vector>

struct DxgiDisplay {
  int index = 0;
  int originX = 0;
  int originY = 0;
  int width = 0;
  int height = 0;
  bool primary = false;
  std::string name;
};

struct DxgiLayout {
  std::vector<DxgiDisplay> displays;
  int virtualLeft = 0;
  int virtualTop = 0;
  int virtualWidth = 0;
  int virtualHeight = 0;
  std::string error;
};

struct DxgiStart {
  bool ok = false;
  std::string error;
  int originX = 0;
  int originY = 0;
  int captureWidth = 0;
  int captureHeight = 0;
  int frameWidth = 0;
  int frameHeight = 0;
  // True when the capture thread opened a synchronous H.264 MFT.
  // JPEG is still produced if this stays false.
  bool h264 = false;
  std::string encoderName;
};

struct DxgiFrame {
  uint64_t frameId = 0;
  int width = 0;
  int height = 0;
  int originX = 0;
  int originY = 0;
  bool keyframe = false;
  std::vector<uint8_t> jpeg;
  std::vector<uint8_t> h264;
};

// Physical-pixel layout from DXGI output desktop coordinates.
DxgiLayout QueryDesktopLayout();

// Starts a capture thread that DuplicateOutput's one display.
// Each published frame is either Annex-B H.264 or a WIC JPEG, not both.
// Input mapping must keep using captureWidth/Height, not the scaled frame size.
DxgiStart StartDesktopCapture(int displayIndex, int maxFrameWidth);
void StopDesktopCapture();

// Copies the newest frame whose id is greater than `since`. Returns false
// when no newer frame is ready.
bool CopyLatestFrame(uint64_t since, DxgiFrame& out);
