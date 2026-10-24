import type { Win32InputCommand } from "./input-mapping";

export type SendInputAddon = {
  sendInputs(commands: Win32InputCommand[]): number;
};

/**
 * Hand mapped commands to the native addon, which calls `SendInput`.
 * Returns how many events Windows accepted. `0` means the addon is absent
 * or there was nothing to send. A negative value means the addon rejected
 * the batch.
 */
export function dispatchWin32Inputs(addon: SendInputAddon | null, commands: Win32InputCommand[]): number {
  if (commands.length === 0 || !addon) return 0;
  return addon.sendInputs(commands);
}
