/**
 * 用户模型落盘：`profile.json`。
 *
 * 新装时是空的（`observations: []`）；她没有观察过，就一个字也写不进 prompt。
 */

import { normalizeProfile, observe } from "../../core/profile.js";
import { DocStore } from "./doc-store.js";

const DEFAULTS = { version: 1, observations: [] };

export class ProfileStore {
  constructor({ dir }) {
    this.doc = new DocStore({
      dir,
      file: "profile.json",
      defaults: DEFAULTS,
      normalize: (raw) => ({ version: 1, observations: normalizeProfile(raw?.observations) }),
    });
  }

  get observations() {
    return this.doc.get().observations;
  }

  observe(input) {
    const result = observe(this.observations, input);
    if (result.changed) this.doc.set({ version: 1, observations: result.profile });
    return result;
  }

  reset() {
    return this.doc.reset();
  }
}
