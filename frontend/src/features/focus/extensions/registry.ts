import type { FocusExtension, FocusExtensionSlot } from "../contracts/types";

export class FocusExtensionRegistry {
  readonly #extensions = new Map<string, FocusExtension>();

  register(extension: FocusExtension): void {
    if (!/^[a-z0-9][a-z0-9.-]{1,63}$/.test(extension.id)) throw new Error("Focus extension identifiers must be stable namespaced keys.");
    if (this.#extensions.has(extension.id)) throw new Error(`Focus extension ${extension.id} is already registered.`);
    this.#extensions.set(extension.id, Object.freeze({ ...extension }));
  }

  forSlot(slot: FocusExtensionSlot): readonly FocusExtension[] {
    return Object.freeze([...this.#extensions.values()].filter((extension) => extension.slot === slot));
  }
}
