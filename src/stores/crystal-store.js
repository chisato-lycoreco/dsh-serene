/**
 * src/stores/crystal-store.js — 结晶层的只读落盘。
 *
 * 为什么是只读：这一层唯一的合法来源是**后果**，不是聊完总结。这个包没有后果账本，
 * 所以写入是 owner 的事（手改 `lessons.jsonl` / `dispositions.json`，或用自己的脚本），
 * 插件只负责读、过闸门、在合适的时候挑一条出来。
 *
 * 读盘纪律和记忆一样：坏行跳过、坏文件当空、不抛。宁可少一条经验，
 * 也不让她的 prompt 因为一份数据文件炸掉。
 *
 * 种子（人格档案里的 `crystals`）只在读的时候合并，不写进数据目录；
 * 同一个 id 以文件为准——owner 想改种子，写一份同 id 的文件条目就行。
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DISPOSITIONS_FILE,
  LESSONS_FILE,
  capDispositions,
  capLessons,
  isDispositionReady,
  isLessonReady,
  normalizeCrystals,
  normalizeDisposition,
  normalizeLesson,
} from "../../core/crystal.js";

const EMPTY = Object.freeze({ lessons: Object.freeze([]), dispositions: Object.freeze([]) });

export class CrystalStore {
  /**
   * @param {object} options
   * @param {string} options.dir 数据目录（和记忆、情绪同一个桶）
   * @param {{lessons?: object[], dispositions?: object[]}} [options.seeds] 人格档案里的种子
   */
  constructor({ dir, seeds = null } = {}) {
    this.dir = dir;
    this.seeds = normalizeCrystals(seeds);
    this.cache = null;
    this.stamp = "";
    this.errors = [];
  }

  get data() {
    this.#refresh();
    return this.cache ?? EMPTY;
  }

  get lessons() {
    return this.data.lessons;
  }

  get dispositions() {
    return this.data.dispositions;
  }

  /** 给 `serene_status` / `serene_state` 看的一眼账。 */
  stats() {
    const data = this.data;
    return {
      lessons: data.lessons.length,
      lessonsReady: data.lessons.filter((item) => item.status === "active" && isLessonReady(item)).length,
      dispositions: data.dispositions.length,
      dispositionsReady: data.dispositions.filter((item) => item.status === "active" && isDispositionReady(item)).length,
      errors: [...this.errors],
      files: {
        lessons: existsSync(join(this.dir, LESSONS_FILE)),
        dispositions: existsSync(join(this.dir, DISPOSITIONS_FILE)),
      },
    };
  }

  /** 手改文件后不用重启：下一次读会按 mtime 自己发现。 */
  reload() {
    this.cache = null;
    this.stamp = "";
    return this.data;
  }

  #refresh() {
    const lessonsPath = join(this.dir, LESSONS_FILE);
    const dispositionsPath = join(this.dir, DISPOSITIONS_FILE);
    const stamp = `${stampOf(lessonsPath)}|${stampOf(dispositionsPath)}`;
    if (this.cache && stamp === this.stamp) return;
    this.stamp = stamp;
    this.errors = [];

    const lessons = mergeById(this.seeds.lessons, this.#readLessons(lessonsPath));
    const dispositions = mergeById(this.seeds.dispositions, this.#readDispositions(dispositionsPath));
    this.cache = {
      lessons: capLessons(lessons),
      dispositions: capDispositions(dispositions),
    };
  }

  #readLessons(path) {
    if (!existsSync(path)) return [];
    let text = "";
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      this.errors.push(`${LESSONS_FILE} 读不动：${error.message}`);
      return [];
    }
    const items = [];
    let lineNumber = 0;
    for (const line of text.split("\n")) {
      lineNumber += 1;
      if (!line.trim()) continue;
      try {
        items.push(normalizeLesson(JSON.parse(line), { source: "file" }));
      } catch {
        // 坏行跳过：一行坏了不该让整层消失。
        this.errors.push(`${LESSONS_FILE} 第 ${lineNumber} 行不是 JSON，已跳过`);
      }
    }
    return items;
  }

  #readDispositions(path) {
    if (!existsSync(path)) return [];
    let book;
    try {
      book = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      this.errors.push(`${DISPOSITIONS_FILE} 读不动：${error.message}`);
      return [];
    }
    const raw = Array.isArray(book) ? book : Array.isArray(book?.items) ? book.items : null;
    if (!raw) {
      this.errors.push(`${DISPOSITIONS_FILE} 既不是数组，也没有 items 数组`);
      return [];
    }
    return raw.map((item) => normalizeDisposition(item));
  }
}

/** 同一个 id：文件条目盖过种子，保证 owner 能改、能退役种子。 */
function mergeById(seeds, learned) {
  const byId = new Map((seeds ?? []).map((item) => [item.id, item]));
  for (const item of learned ?? []) byId.set(item.id, item);
  return [...byId.values()];
}

function stampOf(path) {
  try {
    const stat = statSync(path);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "0:0";
  }
}
