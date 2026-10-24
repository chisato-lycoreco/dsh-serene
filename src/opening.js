/**
 * src/opening.js — 「第一次见面」只发生一次。
 *
 * 为什么需要落盘：如果只看「记忆为空」，那她每次被清空记忆都会重新自我介绍一遍，
 * 用户会觉得自己面对的是一个失忆的客服。见过就是见过，记在 opening.json 里。
 *
 * 形状：{ version, personaId, phase: "pending" | "opened", openedAt }
 * 写入沿用其他 store 的做法：先写临时文件再 rename，断电不会留下半个 JSON。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = 1;

export class OpeningStore {
  #dir;
  #file;
  #personaId;
  #state;
  #loaded = false;

  constructor({ dir, personaId, file = "opening.json" } = {}) {
    this.#dir = dir;
    this.#file = join(dir, file);
    this.#personaId = String(personaId ?? "");
  }

  load() {
    if (this.#loaded) return this.#state;
    this.#loaded = true;
    let raw = null;
    try {
      raw = JSON.parse(readFileSync(this.#file, "utf8"));
    } catch {
      raw = null;
    }
    // 人格换了就重新算「第一次见面」——数据目录本身也按人格分桶，这里是第二道保险。
    if (raw && raw.personaId === this.#personaId && (raw.phase === "pending" || raw.phase === "opened")) {
      this.#state = { version: VERSION, personaId: this.#personaId, phase: raw.phase, openedAt: Number(raw.openedAt) || 0 };
    } else {
      this.#state = { version: VERSION, personaId: this.#personaId, phase: "pending", openedAt: 0 };
    }
    return this.#state;
  }

  /** 还没开过场？ */
  pending() {
    return this.load().phase === "pending";
  }

  /** 开场白已经交给模型了。幂等：重复调用不会改 openedAt。 */
  markOpened(now = Date.now()) {
    const state = this.load();
    if (state.phase === "opened") return state;
    state.phase = "opened";
    state.openedAt = now;
    this.save();
    return state;
  }

  snapshot() {
    return { ...this.load() };
  }

  reset({ now = Date.now() } = {}) {
    this.#state = { version: VERSION, personaId: this.#personaId, phase: "pending", openedAt: 0 };
    this.#loaded = true;
    void now;
    this.save();
    return this.snapshot();
  }

  save() {
    if (!this.#state) return;
    try {
      if (!existsSync(this.#dir)) mkdirSync(this.#dir, { recursive: true });
      const temp = `${this.#file}.tmp`;
      writeFileSync(temp, `${JSON.stringify(this.#state, null, 2)}\n`, "utf8");
      renameSync(temp, this.#file);
    } catch {
      // 落不下盘也不能拦住这一轮对话：下一次会重新算成「还没开场」。
    }
  }
}
