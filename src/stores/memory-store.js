/**
 * MemoryStore — 记忆的落盘与召回。
 *
 * 存储是最笨的那种：一行一条 JSON（jsonl），追加写，读的时候全量加载。
 * 这个量级（几百到几千条）足够快，而且人类可读、可 grep、可手改。
 *
 * 0.2.0 起同一个文件里有三种行，读的时候折起来用：
 *
 *   { id, text, … }                     一条记忆
 *   { type: "reinforce", id, … }        被想起了一次（稳定度与召回计数）
 *   { type: "forget", id, … }           被淘汰了（删了哪条必须可查）
 *
 * 还是追加写：不改历史行，只在后面记一笔。这样进程被杀也不会留下半截 JSON，
 * 而且「她忘了什么」和「她记得什么」一样可查。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MEMORY_CAPACITY,
  MAX_TEXT_CHARS,
  activate,
  normalizeMemory,
  rank,
  reinforce as reinforceMemory,
  retention,
} from "../../core/recall.js";

export class MemoryStore {
  #dir;
  #file;
  #cap;
  #curve;
  #items = null;
  #forgotten = [];
  #patches = new Map();

  constructor({ dir, file = "memories.jsonl", capacity = MEMORY_CAPACITY, curve = "v2" } = {}) {
    if (!dir) throw new Error("MemoryStore 需要一个数据目录");
    this.#dir = dir;
    this.#file = file;
    this.#cap = Math.max(10, Number(capacity) || MEMORY_CAPACITY);
    this.#curve = curve === "v1" ? "v1" : "v2";
  }

  get file() {
    return join(this.#dir, this.#file);
  }

  get curve() {
    return this.#curve;
  }

  get capacity() {
    return this.#cap;
  }

  load() {
    if (this.#items) return this;
    const path = this.file;
    const items = [];
    const patches = new Map();
    const forgotten = new Set();
    this.#forgotten = [];
    this.#patches = patches;
    if (!existsSync(path)) {
      this.#items = items;
      return this;
    }
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const text = line.trim();
      if (!text) continue;
      let row;
      try {
        row = JSON.parse(text);
      } catch {
        // 半截行（进程被杀、磁盘满）直接跳过，不让一条坏记忆拖垮整个文件。
        continue;
      }
      if (row?.type === "forget") {
        forgotten.add(row.id);
        this.#forgotten.push(row);
        continue;
      }
      if (row?.type === "reinforce") {
        patches.set(row.id, { ...(patches.get(row.id) ?? {}), ...row });
        continue;
      }
      if (!row?.id || !row?.text) continue;
      // 老数据可能超过 80 字：读回时原样保留，不替用户改写历史。
      const memory = normalizeMemory(row, { now: Number(row.createdAt) || Date.now(), maxChars: Infinity });
      if (memory) items.push(memory);
    }
    this.#items = items.filter((memory) => !forgotten.has(memory.id));
    for (const memory of this.#items) {
      const patch = patches.get(memory.id);
      if (patch) Object.assign(memory, foldPatch(memory, patch));
    }
    return this;
  }

  /**
   * 写一条记忆。
   *
   * 超过容量时先淘汰「最不该留」的那条：过期的优先，然后按 重要度 × 保持率 淘汰。
   * 淘汰不是静默删除——它会在文件末尾留一行 forget。
   */
  add(input, { now = Date.now() } = {}) {
    this.load();
    const memory = normalizeMemory(input, { now, maxChars: MAX_TEXT_CHARS });
    if (!memory) return null;
    let id = memory.id;
    let suffix = 1;
    while (this.#items.some((item) => item.id === id)) {
      suffix += 1;
      id = `${memory.id}_${suffix}`;
    }
    memory.id = id;

    this.#makeRoom(now);
    mkdirSync(this.#dir, { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(memory)}\n`, "utf8");
    this.#items.push(memory);
    return memory;
  }

  /**
   * 召回。v2 允许空数组——这一轮没有相关记忆，比硬塞两条无关的更像人。
   *
   * @param {string} query
   * @param {{limit?: number, now?: number, mood?: number, halfLifeDays?: number}} [options]
   */
  recall(query, { limit = 5, now = Date.now(), mood = 0, halfLifeDays = 45 } = {}) {
    this.load();
    if (this.#curve === "v1") return rank(this.#items, query, { limit, now, halfLifeDays });
    return activate(this.#items, query, { limit, now, mood });
  }

  /**
   * 记「这几条真的被用上了」。只有确实进了回复才该调——看一眼不算想起。
   * 追加一行 reinforce，不修改原记忆行；年龄仍从写入时间算。
   */
  reinforce(ids, { now = Date.now() } = {}) {
    this.load();
    const wanted = new Set((Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean));
    const touched = [];
    for (const memory of this.#items) {
      if (!wanted.has(memory.id)) continue;
      const patch = reinforceOf(memory, now);
      Object.assign(memory, patch);
      this.#patches.set(memory.id, { ...(this.#patches.get(memory.id) ?? {}), ...patch });
      appendFileSync(this.file, `${JSON.stringify({ type: "reinforce", ...patch })}\n`, "utf8");
      touched.push(patch);
    }
    return touched;
  }

  /** 她忘了什么（淘汰记录，新到旧）。 */
  forgotten({ limit = 10 } = {}) {
    this.load();
    return this.#forgotten.slice(-Math.max(1, limit)).reverse();
  }

  all() {
    this.load();
    return this.#items;
  }

  get size() {
    this.load();
    return this.#items.length;
  }

  /** 归档读数：条数、类型分布、平均稳定度。给 serene_status 用。 */
  stats({ now = Date.now() } = {}) {
    this.load();
    const kinds = {};
    let stability = 0;
    for (const memory of this.#items) {
      kinds[memory.kind] = (kinds[memory.kind] ?? 0) + 1;
      stability += Number(memory.stability) || 0;
    }
    return {
      size: this.#items.length,
      capacity: this.#cap,
      curve: this.#curve,
      kinds,
      forgotten: this.#forgotten.length,
      averageStability: this.#items.length ? Math.round((stability / this.#items.length) * 10) / 10 : 0,
      averageRetention: this.#items.length
        ? Math.round(
            (this.#items.reduce((sum, memory) => sum + retention(memory, now), 0) / this.#items.length) * 1000,
          ) / 1000
        : 0,
    };
  }

  /** 容量管理：腾一个位置出来。过期的先走，然后 重要度 × 保持率 最低的。 */
  #makeRoom(now) {
    if (this.#items.length < this.#cap) return;
    let victim = null;
    let victimScore = Infinity;
    for (const memory of this.#items) {
      const expired = Number(memory.validUntil) > 0 && Number(memory.validUntil) < now;
      const score = (expired ? -1 : 0) + Number(memory.importance ?? 0.5) * retention(memory, now);
      if (score < victimScore) {
        victim = memory;
        victimScore = score;
      }
    }
    if (!victim) return;
    const record = {
      type: "forget",
      id: victim.id,
      at: now,
      kind: victim.kind,
      text: victim.text,
      reason: Number(victim.validUntil) > 0 && Number(victim.validUntil) < now ? "expired" : "capacity",
    };
    appendFileSync(this.file, `${JSON.stringify(record)}\n`, "utf8");
    this.#forgotten.push(record);
    this.#items = this.#items.filter((memory) => memory !== victim);
  }
}

/** 强化补丁：公式只在 core 里写一遍，这里只补一个落盘用的时间戳。 */
function reinforceOf(memory, now) {
  return { ...reinforceMemory(memory, { now }), at: now };
}

function foldPatch(memory, patch) {
  return {
    stability: Number(patch.stability) || memory.stability,
    lastRecall: Number(patch.lastRecall) || memory.lastRecall,
    recallCount: Math.max(Number(patch.recallCount) || 0, memory.recallCount),
  };
}
