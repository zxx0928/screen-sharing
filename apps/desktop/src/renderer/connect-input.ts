/** Same length as `DEVICE_CODE_LENGTH` in `@screen-sharing/protocol`. */
const DEVICE_CODE_LENGTH = 9;

/**
 * Same 9-digit rule as `normalizeDeviceCode` in `@screen-sharing/protocol`.
 * Kept local so desktop tests can load this file. The protocol package is ESM-only.
 */
function normalizeDeviceCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  if (digits.length !== DEVICE_CODE_LENGTH || !/^\d{9}$/.test(digits)) return null;
  return digits;
}

/**
 * The locked home has one field: "设备码或连接码".
 * The protocol still joins with a 9-digit device code plus an optional password.
 * A bare code connects when the host has no password. A code followed by a
 * space or `/` carries the secure code in the same field.
 */
export function parseConnectInput(input: string): { code: string; password?: string } | null {
  const trimmed = input.trim().replace(/\/+$/, "").trim();
  if (!trimmed) return null;

  const direct = normalizeDeviceCode(trimmed);
  if (direct) return { code: direct };

  const match = trimmed.match(/^([\d\s-]{9,13}?)\s*(?:\/|\s)\s*(\S(?:.*\S)?)$/);
  if (!match?.[1] || !match[2]) return null;
  const code = normalizeDeviceCode(match[1]);
  if (!code) return null;
  const password = match[2].trim();
  if (!password) return { code };
  return { code, password };
}
