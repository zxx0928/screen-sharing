export type ResolvedCapturePlan =
  | { mode: "display-media" }
  | { mode: "electron-desktop"; sourceId: string }
  | { mode: "dxgi"; displayIndex: number; fallbackSourceId: string | null };

export function chooseDisplayIndex(displays: Array<{ index: number; primary: boolean }>): number {
  if (displays.length === 0) return 0;
  const primary = displays.find((display) => display.primary);
  return primary?.index ?? displays[0]?.index ?? 0;
}

/**
 * Windows with the native addon uses DXGI Desktop Duplication.
 * Windows without the addon still avoids the getDisplayMedia picker by
 * handing Chromium's desktop capturer (itself DXGI) a screen source id.
 * Other platforms keep getDisplayMedia so Linux dev sessions still run.
 */
export function resolveCapturePlan(input: {
  platform: string;
  nativeReady: boolean;
  displayIndex: number;
  fallbackSourceId: string | null;
}): ResolvedCapturePlan {
  if (input.platform === "win32" && input.nativeReady) {
    const displayIndex = Number.isInteger(input.displayIndex) && input.displayIndex >= 0 ? input.displayIndex : 0;
    return { mode: "dxgi", displayIndex, fallbackSourceId: input.fallbackSourceId };
  }
  if (input.platform === "win32" && input.fallbackSourceId) {
    return { mode: "electron-desktop", sourceId: input.fallbackSourceId };
  }
  return { mode: "display-media" };
}
