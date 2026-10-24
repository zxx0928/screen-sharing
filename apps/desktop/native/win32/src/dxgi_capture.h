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
};

struct DxgiJpegFrame {
  uint64_t frameId = 0;
  int width = 0;
  int height = 0;
  int originX = 0;
  int originY = 0;
  std::vector<uint8_t> jpeg;
};

// Physical-pixel layout from DXGI output desktop coordinates.
DxgiLayout QueryDesktopLayout();

// Starts a capture thread that DuplicateOutput's one display and publishes
// WIC JPEG previews. Input mapping must keep using captureWidth/Height,
// not the possibly downscaled JPEG size.
DxgiStart StartDesktopCapture(int displayIndex, int maxFrameWidth);
void StopDesktopCapture();

// Copies the newest JPEG whose id is greater than `since`. Returns false
// when no newer frame is ready.
bool CopyLatestJpeg(uint64_t since, DxgiJpegFrame& out);
