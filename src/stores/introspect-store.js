/**
 * 夜里的自省落盘：`introspect.json`。
 *
 * 只记「哪一晚已经自省过 + 那晚写了什么」，用来保证一晚只出现一次，
 * 也方便 `serene_state` / `serene_status` 看见她昨晚想了什么。
 */

import { dueForReflection, nightKey } from "../../core/introspect.js";
import { DocStore } from "./doc-store.js";

const DEFAULTS = { version: 1, lastKey: "", text: "", at: 0 };

export class IntrospectStore {
  constructor({ dir }) {
    this.doc = new DocStore({
      dir,
      file: "introspect.json",
      defaults: DEFAULTS,
      normalize: (raw) => ({
        version: 1,
        lastKey: String(raw?.lastKey ?? ""),
        text: String(raw?.text ?? ""),
        at: Number(raw?.at) || 0,
      }),
    });
  }

  get last() {
    return this.doc.get();
  }

  /** 这一晚该不该自省。 */
  due(now = Date.now()) {
    return dueForReflection(now, this.last.lastKey);
  }

  /** 记下这一晚，返回当时的键。 */
  mark(text, now = Date.now()) {
    const key = nightKey(now);
    this.doc.set({ version: 1, lastKey: key, text: String(text ?? ""), at: Number(now) || 0 });
    return key;
  }

  reset() {
    return this.doc.reset();
  }
}
