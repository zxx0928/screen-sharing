/** JPEG preview width cap. Input mapping still uses the full DXGI output. */
export const DXGI_MAX_FRAME_WIDTH = 1920;

/**
 * Even frame size used before WIC JPEG encode.
 * The native addon implements the same integer arithmetic; keep the two in sync.
 *
 * Examples (max width 1920):
 * - 1920x1080 → 1920x1080
 * - 2560x1440 → 1920x1080
 * - 3840x2160 → 1920x1080
 * - 1366x768 → 1366x768
 * - 1365x769 → 1364x768
 */
export function fitEvenFrame(
  srcWidth: number,
  srcHeight: number,
  maxWidth: number,
): { width: number; height: number } | null {
  if (!Number.isInteger(srcWidth) || !Number.isInteger(srcHeight) || !Number.isInteger(maxWidth)) return null;
  if (srcWidth < 2 || srcHeight < 2 || maxWidth < 2) return null;
  let width = srcWidth;
  let height = srcHeight;
  if (width > maxWidth) {
    height = Math.floor((height * maxWidth) / width);
    width = maxWidth;
  }
  if (width < 2) width = 2;
  if (height < 2) height = 2;
  width &= ~1;
  height &= ~1;
  if (width < 2 || height < 2) return null;
  return { width, height };
}
