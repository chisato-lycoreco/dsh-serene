/**
 * LeisureStore — 消遣记录的落盘。
 *
 * 和 MemoryStore 一个写法：一行一条 JSON（jsonl），追加写，读的时候全量加载。
 * 消遣不是记忆，不需要召回和遗忘；它只有两件事要准：
 *
 *   1. 这一段从什么时候开始、到什么时候结束（`startAt` / `endAt`）；
 *   2. 到底看完没有（`finished` / `unfinished`）。
 *
 * 所以平时只 append，超过 300 条才把文件原子重写一遍——只留最近的三百条，
 * 再往前的时间线已经没人会问了。坏行（半截 JSON、缺字段）读的时候直接跳过，
 * 不抛：一条坏记录不该让她的今天读不出来。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { normalizeKind } from "../../core/leisure.js";

/** 留存上限：再往前的时间线没人问了。 */
export const LEISURE_CAPACITY = 300;
export const LEISURE_FILE = "leisure.jsonl";

const MINUTE = 60_000;
const DEFAULT_MINUTES = 20;

export class LeisureStore {
  #dir;
  #file;
  #cap;
  #items = null;

  constructor({ dir, file = LEISURE_FILE, capacity = LEISURE_CAPACITY } = {}) {
    if (!dir) throw new Error("LeisureStore 需要一个数据目录");
    this.#dir = dir;
    this.#file = file;
    this.#cap = Math.max(1, Math.floor(Number(capacity) || LEISURE_CAPACITY));
  }

  get file() {
    return join(this.#dir, this.#file);
  }

  get capacity() {
    return this.#cap;
  }

  get size() {
    this.load();
    return this.#items.length;
  }

  /** 懒加载：第一次用到才读盘。坏行跳过，超过容量只裁内存（下次写的时候再收文件）。 */
  load() {
    if (this.#items) return this;
    this.#items = [];
    let raw = "";
    try {
      raw = existsSync(this.file) ? readFileSync(this.file, "utf8") : "";
    } catch {
      return this;
    }
    for (const line of raw.split("\n")) {
      const text = line.trim();
      if (!text) continue;
      let row;
      try {
        row = JSON.parse(text);
      } catch {
        // 半截行（进程被杀、磁盘满）直接跳过。
        continue;
      }
      const entry = normalizeEntry(row);
      if (entry) this.#items.push(entry);
    }
    this.#items.sort((a, b) => a.at - b.at);
    if (this.#items.length > this.#cap) this.#items = this.#items.slice(-this.#cap);
    return this;
  }

  /**
   * 记一段消遣。`at` 是开始那一刻（`startAt`，缺了就用 `endAt - minutes`）。
   *
   * @param {{kind?: string, title?: string, minutes?: number, startAt?: number, endAt?: number,
   *   finished?: boolean, unfinished?: boolean, at?: number}} input
   * @returns {object} 落盘的那一条
   */
  record({ kind, title = "", minutes, startAt, endAt, finished, unfinished, at } = {}) {
    this.load();
    const length = Number(minutes);
    const planned = Number.isFinite(length) && length > 0 ? Math.max(1, Math.round(length)) : 0;

    let start = firstFinite(startAt, at);
    let stop = firstFinite(endAt);
    if (start === null && stop !== null) start = stop - (planned || DEFAULT_MINUTES) * MINUTE;
    if (start === null) start = Date.now();
    if (stop === null || stop <= start) stop = start + (planned || DEFAULT_MINUTES) * MINUTE;

    const entry = {
      id: randomUUID(),
      at: start,
      kind: normalizeKind(kind),
      title: String(title ?? "").trim(),
      minutes: planned || Math.max(1, Math.round((stop - start) / MINUTE)),
      startAt: start,
      endAt: stop,
      finished: finished !== false && unfinished !== true,
      unfinished: finished === false || unfinished === true,
    };

    mkdirSync(this.#dir, { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`, "utf8");
    this.#items.push(entry);
    if (this.#items.length > this.#cap) {
      this.#items = this.#items.slice(-this.#cap);
      this.#rewrite();
    }
    return entry;
  }

  /** 全部记录，按开始时间正序（返回新数组，改它不影响 store）。 */
  all() {
    this.load();
    return [...this.#items];
  }

  /** 从 `at` 那一刻（含）开始的那几条。 */
  since(at) {
    this.load();
    const from = Number(at);
    if (!Number.isFinite(from)) return [];
    return this.#items.filter((entry) => entry.at >= from);
  }

  /**
   * 此刻手上那一件：开始了、还没到点。老记录没有 endAt 的，早就过去了。
   *
   * @param {number} now
   * @returns {object|null}
   */
  activeAt(now) {
    this.load();
    const at = Number(now);
    if (!Number.isFinite(at)) return null;
    return this.#items.filter((entry) => entry.startAt <= at && entry.endAt > at).at(-1) ?? null;
  }

  /** 最近几条，按开始时间正序（`recent(1)` 是最后那条）。 */
  recent(limit = 10) {
    this.load();
    const keep = Math.max(1, Math.floor(Number(limit) || 10));
    return this.#items.slice(-keep);
  }

  /** 原子重写：先写临时文件再 rename，进程被杀也不会留下半截 JSONL。 */
  #rewrite() {
    try {
      mkdirSync(this.#dir, { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      const text = this.#items.map((entry) => JSON.stringify(entry)).join("\n");
      writeFileSync(temp, text ? `${text}\n` : "", "utf8");
      renameSync(temp, this.file);
    } catch {
      // 写不了就留着旧文件：内存里已经是裁过的，下次写还会再试一遍。
    }
  }
}

function firstFinite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

/** 读回来的一条：缺 id / kind / 时间的都算坏行。 */
function normalizeEntry(row) {
  if (!row || typeof row !== "object") return null;
  const id = String(row.id ?? "").trim();
  const kind = String(row.kind ?? "").trim();
  const at = Number(row.at);
  const endAt = Number(row.endAt);
  if (!id || !kind || !Number.isFinite(at) || !Number.isFinite(endAt)) return null;
  const startAt = Number.isFinite(Number(row.startAt)) ? Number(row.startAt) : at;
  const minutes = Number(row.minutes);
  return {
    id,
    at,
    kind: normalizeKind(kind),
    title: String(row.title ?? "").trim(),
    minutes: Number.isFinite(minutes) && minutes > 0
      ? Math.max(1, Math.round(minutes))
      : Math.max(1, Math.round((endAt - startAt) / MINUTE)),
    startAt,
    endAt,
    finished: row.finished !== false && row.unfinished !== true,
    unfinished: row.finished === false || row.unfinished === true,
  };
}
