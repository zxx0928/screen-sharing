#include "send_input.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <cstdio>

namespace {

constexpr DWORD kMouseAllowed = MOUSEEVENTF_MOVE | MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_LEFTUP | MOUSEEVENTF_RIGHTDOWN |
                                MOUSEEVENTF_RIGHTUP | MOUSEEVENTF_MIDDLEDOWN | MOUSEEVENTF_MIDDLEUP | MOUSEEVENTF_WHEEL |
                                MOUSEEVENTF_HWHEEL | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;

constexpr DWORD kKeyAllowed = KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP | KEYEVENTF_SCANCODE;

bool ValidMouse(const MappedInput& input) {
  if (input.flags == 0 || (input.flags & ~kMouseAllowed) != 0) return false;
  if ((input.flags & MOUSEEVENTF_ABSOLUTE) != 0) {
    if (input.dx < 0 || input.dx > 65535 || input.dy < 0 || input.dy > 65535) return false;
  }
  if ((input.flags & (MOUSEEVENTF_WHEEL | MOUSEEVENTF_HWHEEL)) != 0) {
    if (input.mouseData < -32768 || input.mouseData > 32767) return false;
  }
  return true;
}

bool ValidKey(const MappedInput& input) {
  if ((input.flags & KEYEVENTF_SCANCODE) == 0) return false;
  if ((input.flags & ~kKeyAllowed) != 0) return false;
  if (input.scan == 0 || input.scan > 0xff) return false;
  return true;
}

}  // namespace

int SendMappedInputs(const std::vector<MappedInput>& inputs, std::string& error) {
  if (inputs.empty()) return 0;
  if (inputs.size() > 128) {
    error = "too many inputs";
    return -1;
  }

  std::vector<INPUT> batch;
  batch.reserve(inputs.size());
  for (const MappedInput& input : inputs) {
    INPUT native = {};
    if (input.type == MappedInput::Mouse) {
      if (!ValidMouse(input)) {
        error = "invalid mouse input";
        return -1;
      }
      native.type = INPUT_MOUSE;
      native.mi.dx = input.dx;
      native.mi.dy = input.dy;
      native.mi.mouseData = static_cast<DWORD>(input.mouseData);
      native.mi.dwFlags = input.flags;
      native.mi.time = 0;
      native.mi.dwExtraInfo = 0;
    } else if (input.type == MappedInput::Key) {
      if (!ValidKey(input)) {
        error = "invalid key input";
        return -1;
      }
      native.type = INPUT_KEYBOARD;
      native.ki.wVk = 0;
      native.ki.wScan = static_cast<WORD>(input.scan);
      native.ki.dwFlags = input.flags;
      native.ki.time = 0;
      native.ki.dwExtraInfo = 0;
    } else {
      error = "unknown input";
      return -1;
    }
    batch.push_back(native);
  }

  const UINT sent = SendInput(static_cast<UINT>(batch.size()), batch.data(), sizeof(INPUT));
  if (sent != batch.size()) {
    error = "SendInput did not accept the full batch";
    std::fprintf(stderr, "[input] SendInput inserted %u of %zu (GetLastError=%lu)\n", sent, batch.size(),
                 static_cast<unsigned long>(GetLastError()));
  }
  return static_cast<int>(sent);
}
