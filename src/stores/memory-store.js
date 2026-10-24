/**
 * MemoryStore — 记忆的落盘与召回。
 *
 * 存储是最笨的那种：一行一条 JSON（jsonl），追加写，读的时候全量加载。
 * 这个量级（几千条以内）足够快，而且人类可读、可 grep、可手改。
 *
 * 真要做大，把 add/recall 换成向量库或外部记忆服务即可，
 * 上层工具签名不用变。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeMemory, rank } from "../../core/recall.js";

export class MemoryStore {
  #dir;
  #file;
  #items = null;

  constructor({ dir, file = "memories.jsonl" } = {}) {
    if (!dir) throw new Error("MemoryStore 需要一个数据目录");
    this.#dir = dir;
    this.#file = file;
  }

  get file() {
    return join(this.#dir, this.#file);
  }

  load() {
    if (this.#items) return this;
    const path = this.file;
    this.#items = [];
    if (!existsSync(path)) return this;
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const text = line.trim();
      if (!text) continue;
      try {
        this.#items.push(JSON.parse(text));
      } catch {
        // 半截行（进程被杀、磁盘满）直接跳过，不让一条坏记忆拖垮整个文件。
      }
    }
    return this;
  }

  add(input, { now = Date.now() } = {}) {
    this.load();
    const memory = normalizeMemory(input, { now });
    if (!memory) return null;
    mkdirSync(this.#dir, { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(memory)}\n`, "utf8");
    this.#items.push(memory);
    return memory;
  }

  recall(query, { limit = 5, now = Date.now(), halfLifeDays = 45 } = {}) {
    this.load();
    return rank(this.#items, query, { limit, now, halfLifeDays });
  }

  all() {
    this.load();
    return this.#items;
  }

  get size() {
    this.load();
    return this.#items.length;
  }
}
