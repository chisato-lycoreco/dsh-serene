/**
 * MotivationStore — 主动性状态的落盘边界。
 *
 * core/motivation.js 是纯函数：给定状态和时间，算出「这次该不该开口」。
 * 这个类只负责把它写下来（原子写），以及记住三件事：
 *   1. 今天开过几次口（跨天清零）；
 *   2. 上一次开口是什么时候；
 *   3. 有没有一个还没退掉的 hold。
 *
 * 状态文件是普通 JSON，可以打开看、可以手改、可以删。删掉就等于她忘了今天说过几次。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROACTIVE,
  commit as commitMotivation,
  decide as decideMotivation,
  normalizeState,
  reject as rejectMotivation,
} from "../../core/motivation.js";

export class MotivationStore {
  #dir;
  #file;
  #policy;
  #state = null;

  constructor({ dir, file = "motivation.json", policy = PROACTIVE } = {}) {
    if (!dir) throw new Error("MotivationStore 需要一个数据目录");
    this.#dir = dir;
    this.#file = file;
    this.#policy = policy;
  }

  get file() {
    return join(this.#dir, this.#file);
  }

  load(now = Date.now()) {
    if (this.#state) return this;
    let raw = null;
    try {
      raw = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      raw = null;
    }
    this.#state = normalizeState(raw ?? {}, { now });
    return this;
  }

  /**
   * 这次该不该开口。读操作，但会把新产生的 hold 记下来——
   * 否则下一次调用又当成「没有 hold」，克制就变成了每 20 分钟重新想一遍。
   */
  decide({ now = Date.now(), layers = {}, lastInteractionAt = 0, asleep = false } = {}) {
    this.load(now);
    const decision = decideMotivation({
      now,
      layers,
      lastInteractionAt,
      asleep,
      state: this.#state,
      policy: this.#policy,
    });
    if (decision.hold && decision.hold.at === now) {
      this.#state.hold = {
        reason: decision.hold.reason,
        why: decision.hold.why,
        at: decision.hold.at,
        expiresAt: decision.hold.expiresAt,
      };
      this.save();
    }
    return decision;
  }

  /** 她真的开了口：预算 −1，hold 清掉。 */
  commit({ now = Date.now() } = {}) {
    this.load(now);
    this.#state = commitMotivation(this.#state, { now });
    this.save();
    return this.snapshot({ now });
  }

  /** 被拒绝：也算开过口，另记一段冷却。 */
  reject({ now = Date.now() } = {}) {
    this.load(now);
    this.#state = rejectMotivation(this.#state, { now, policy: this.#policy });
    this.save();
    return this.snapshot({ now });
  }

  snapshot({ now = Date.now() } = {}) {
    this.load(now);
    const state = normalizeState(this.#state, { now });
    return {
      lastProactiveAt: state.lastProactiveAt,
      today: state.today,
      hold: state.hold,
      cooldownUntil: state.cooldownUntil,
      remaining: Math.max(0, this.#policy.perDay - state.today.count),
      policy: { ...this.#policy },
    };
  }

  reset({ now = Date.now() } = {}) {
    this.load(now);
    this.#state = normalizeState({}, { now });
    this.save();
  }

  /** 原子写：先写临时文件再 rename。 */
  save() {
    if (!this.#state) return;
    mkdirSync(this.#dir, { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.#state, null, 2)}\n`, "utf8");
    renameSync(temp, this.file);
  }

  flush() {
    if (this.#state) this.save();
  }
}
