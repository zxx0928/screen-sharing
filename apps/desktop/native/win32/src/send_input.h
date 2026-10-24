#pragma once

#include <cstdint>
#include <string>
#include <vector>

// One event already mapped by the TypeScript host.
// Mouse dx/dy are 0..65535 when MOUSEEVENTF_ABSOLUTE is set.
// Key scan is a set-1 code; flags include KEYEVENTF_SCANCODE.
struct MappedInput {
  enum Type { Mouse = 1, Key = 2 };
  Type type = Mouse;
  int32_t dx = 0;
  int32_t dy = 0;
  int32_t mouseData = 0;
  uint32_t flags = 0;
  uint32_t scan = 0;
};

// Calls Win32 SendInput. Returns the number of events inserted, or -1 if the
// batch was rejected before the call. `error` is set when the count is short.
int SendMappedInputs(const std::vector<MappedInput>& inputs, std::string& error);
