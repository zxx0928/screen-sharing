import type { InputEvent } from "@screen-sharing/protocol";
import type { InjectionSession } from "./injection-session";
import type { InjectionTarget, Win32InputCommand } from "./input-mapping";

export type ControlChange = {
  changed: boolean;
  /** Key-up / button-up commands. Non-empty only when control turns off while something is held. */
  release: Win32InputCommand[];
};

/**
 * Host-side SendInput policy.
 *
 * Default is off (`DEFAULT_REMOTE_CONTROL_ENABLED`). While off, input events
 * are dropped before they are mapped, so they are not remembered as held and
 * nothing is handed to SendInput. Turning control off still returns releases
 * for keys and buttons that were injected while it was on — those ups have
 * to reach SendInput or the key sticks.
 */
export class RemoteControlGate {
  private allowed: boolean;

  /**
   * `initiallyAllowed` is `DEFAULT_REMOTE_CONTROL_ENABLED` from the protocol
   * package (false). The default parameter matches that so unit tests do not
   * have to load the ESM package from the CJS test runner.
   */
  constructor(
    private readonly session: InjectionSession,
    initiallyAllowed = false,
  ) {
    this.allowed = initiallyAllowed;
  }

  isAllowed(): boolean {
    return this.allowed;
  }

  setAllowed(allowed: boolean): ControlChange {
    const next = allowed === true;
    if (next === this.allowed) return { changed: false, release: [] };
    this.allowed = next;
    if (next) return { changed: true, release: [] };
    return { changed: true, release: this.session.release() };
  }

  /** Empty when control is off. The event is not applied to the injection session. */
  commandsFor(event: InputEvent, target: InjectionTarget | null): Win32InputCommand[] {
    if (!this.allowed) return [];
    return this.session.apply(event, target);
  }
}
