/**
 * web/lib/watch/collect.mjs — 看护台的采集器：只读她的 traces.jsonl，长出自己的瘦记录。
 *
 * 和私仓那台独立的看护台不同，这里不另起进程、也不轮询 HTTP：
 * 网页版本来就和她在同一个进程里，直接读 `<dataDir>/traces.jsonl` 就行，
 * 少一跳、少一个端口，也少一次「页面被打开」的副作用。
 *
 * 三条纪律：
 *   1. **只读。** 除了 `<dataDir>/watch/` 什么都不写；删掉这一层她照常说话。
 *   2. **不存正文。** 瘦记录里只有数字、枚举和 id（见 extract.mjs）。
 *   3. **增量。** 按字节 offset 追文件；文件被归档 / 截断就从头再读，靠 id 去重兜底。
 *
 * 采集只在网页版进程活着时有意义——这正是它要看护的东西：
 * 只要她还在说话，就有人在记。
 */

import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { extractTurn } from "./extract.mjs";
import { buildDaily, readDaily } from "./rollup.mjs";
import {
  DEFAULTS,
  appendJsonl,
  dayKey,
  logLine,
  readJson,
  readJsonl,
  watchPaths,
  writeJsonAtomic,
  writeLinesAtomic,
} from "./util.mjs";

const DAY = 86_400_000;
const MAX_TURNS = 5000;

export class WatchCollector extends EventEmitter {
  /**
   * @param {object} params
   * @param {string} params.dataDir 人格分桶目录（traces.jsonl / chat.jsonl 所在处）
   * @param {object} [params.config] 覆盖 DEFAULTS（timezone / dayBoundaryHour / pollMs）
   * @param {object} [params.paths] watchPaths() 的结果，测试里可注入临时目录
   * @param {() => number} [params.now]
   */
  constructor({ dataDir, config = {}, paths = null, now = () => Date.now() } = {}) {
    super();
    this.dataDir = dataDir;
    this.config = { ...DEFAULTS, ...config };
    this.paths = paths ?? watchPaths(dataDir);
    this.now = now;
    this.traceFile = join(dataDir, "traces.jsonl");
    this.chatFile = join(dataDir, "chat.jsonl");

    this.turns = [];
    this.gates = [];
    this.seen = new Set();
    this.offset = 0;
    this.daily = {};
    this.lastPollAt = 0;
    this.lastError = null;
    this.startedAt = 0;
    this.timers = [];
    this.rollingUp = false;
  }

  /* ---------- 生命周期 ---------- */

  start() {
    if (this.timers.length) return this;
    this.startedAt = this.now();
    this.loadRecent();
    this.poll();
    this.rollupTick();
    this.timers.push(setInterval(() => this.poll(), this.config.pollMs).unref());
    this.timers.push(setInterval(() => this.rollupTick(), this.config.rollupMs).unref());
    logLine(this.paths.logFile, `采集开始：offset=${this.offset} 轮=${this.turns.length}`);
    return this;
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.saveCursor();
    return this;
  }

  /** 把看护台自己的产物读回内存（只读最近 keepDays 天）。 */
  loadRecent() {
    this.daily = readDaily(this.paths.metricsFile);
    const cursor = readJson(this.paths.cursorFile, null);
    if (Number.isFinite(Number(cursor?.offset))) this.offset = Number(cursor.offset);
    if (Array.isArray(cursor?.seen)) for (const id of cursor.seen) this.seen.add(String(id));

    const since = this.now() - this.config.keepDays * DAY;
    const dates = new Set();
    for (let i = 0; i < this.config.keepDays; i += 1) dates.add(dayKey(this.now() - i * DAY, this.config));

    // 注意：seen 只管「采集时别重复落盘」，不是「历史里别读」。
    // 重启后光标里全是见过的 id，若拿 seen 过滤就一条历史都读不回来了。
    const loaded = new Set(this.turns.map((turn) => turn.id));
    for (const date of dates) {
      for (const turn of readJsonl(join(this.paths.turnsDir, `${date}.jsonl`))) {
        if (!turn?.id || loaded.has(turn.id)) continue;
        loaded.add(turn.id);
        this.seen.add(turn.id);
        if (Number(turn.t) >= since) this.turns.push(turn);
      }
    }
    for (const gate of readJsonl(this.paths.gatesFile, 800)) {
      if (Number(gate.t) >= since) this.gates.push(gate);
    }
    this.turns.sort((a, b) => a.t - b.t);
    this.turns = this.turns.slice(-MAX_TURNS);
    return this.turns.length;
  }

  /* ---------- 采集 ---------- */

  /**
   * 追一次 traces.jsonl。
   * 只消费到最后一个换行：写到一半的行留给下一轮，不当作坏数据。
   */
  poll() {
    const at = this.now();
    this.lastPollAt = at;
    const size = byteSize(this.traceFile);
    if (size < this.offset) {
      // 文件被归档 / 截断：从头读，靠 seen 去重，不会重复计数。
      this.offset = 0;
    }
    if (size === this.offset) {
      this.emit("poll", { read: 0, kept: 0, gates: 0, at });
      return { read: 0, kept: 0, gates: 0, at };
    }

    let buffer;
    try {
      buffer = readFileSync(this.traceFile);
    } catch (error) {
      this.lastError = String(error?.message ?? error);
      return { read: 0, kept: 0, gates: 0, at, error: this.lastError };
    }

    const chunk = buffer.subarray(this.offset).toString("utf8");
    const cut = chunk.lastIndexOf("\n");
    if (cut < 0) return { read: 0, kept: 0, gates: 0, at, partial: true };

    const complete = chunk.slice(0, cut + 1);
    this.offset += Buffer.byteLength(complete, "utf8");

    let read = 0;
    let kept = 0;
    let gates = 0;
    for (const line of complete.split("\n")) {
      if (!line.trim()) continue;
      read += 1;
      let trace;
      try {
        trace = JSON.parse(line);
      } catch {
        continue;
      }
      const result = this.ingest(trace);
      if (result?.turn) kept += 1;
      gates += result?.gates?.length ?? 0;
    }

    if (read) {
      this.lastError = null;
      this.saveCursor();
      this.emit("poll", { read, kept, gates, at });
    }
    return { read, kept, gates, at };
  }

  /** 一条 trace → 一行瘦记录 + 红线；重复的 id 直接丢掉。 */
  ingest(trace) {
    const id = String(trace?.id ?? "");
    const at = Number(trace?.at) || 0;
    if (!id || !at) return null;
    if (this.seen.has(id)) return null;
    this.seen.add(id);
    if (this.seen.size > this.config.maxSeen) this.pruneSeen();

    let extracted;
    try {
      extracted = extractTurn(trace);
    } catch (error) {
      this.lastError = `透视压缩失败：${error?.message ?? error}`;
      return null;
    }
    const { turn, gates } = extracted;

    this.turns.push(turn);
    if (this.turns.length > MAX_TURNS) this.turns.splice(0, this.turns.length - MAX_TURNS);
    this.append(join(this.paths.turnsDir, `${dayKey(at, this.config)}.jsonl`), turn);

    for (const gate of gates) {
      this.gates.push(gate);
      this.append(this.paths.gatesFile, gate);
    }
    if (this.gates.length > MAX_TURNS) this.gates.splice(0, this.gates.length - MAX_TURNS);

    this.emit("turn", { turn, gates });
    return { turn, gates };
  }

  append(path, record) {
    try {
      appendJsonl(path, record);
    } catch (error) {
      this.lastError = `写瘦记录失败：${error?.message ?? error}`;
    }
  }

  pruneSeen() {
    this.seen = new Set([...this.seen].slice(-Math.floor(this.config.maxSeen / 2)));
  }

  saveCursor() {
    try {
      writeJsonAtomic(this.paths.cursorFile, {
        offset: this.offset,
        seen: [...this.seen].slice(-500),
        updatedAt: this.now(),
      });
    } catch {
      /* 光标写不动顶多下次重读一遍（靠 id 去重） */
    }
  }

  /* ---------- 压行 ---------- */

  /** 重算今天和昨天：跨日那几个小时里两边都可能变。 */
  rollupTick() {
    if (this.rollingUp) return this.daily;
    this.rollingUp = true;
    try {
      const dates = new Set([dayKey(this.now(), this.config), dayKey(this.now() - DAY, this.config)]);
      let dirty = false;
      for (const date of dates) {
        const row = this.recomputeDay(date);
        if (JSON.stringify(row) !== JSON.stringify(this.daily[date] ?? null)) dirty = true;
        this.daily[date] = row;
      }
      if (dirty) this.saveDaily();
      return this.daily;
    } finally {
      this.rollingUp = false;
    }
  }

  recomputeDay(date) {
    return buildDaily({
      date,
      turns: this.turns,
      gates: this.gates,
      config: this.config,
      now: this.now(),
    });
  }

  saveDaily() {
    const rows = Object.keys(this.daily)
      .sort()
      .map((date) => this.daily[date]);
    try {
      writeLinesAtomic(this.paths.metricsFile, rows);
      return true;
    } catch (error) {
      this.lastError = `写 metrics.jsonl 失败：${error?.message ?? error}`;
      return false;
    }
  }

  /* ---------- 派生视图 ---------- */

  turnsFor(date) {
    return this.turns.filter((turn) => dayKey(turn.t, this.config) === date);
  }

  gatesFor(date) {
    return this.gates.filter((gate) => dayKey(gate.t, this.config) === date);
  }

  /** 页面第一屏：今天 + 昨天 + 近 N 天 + 体检。 */
  summary({ days = 14, gateLimit = 30 } = {}) {
    const today = dayKey(this.now(), this.config);
    const yesterday = dayKey(this.now() - DAY, this.config);
    return {
      ok: true,
      date: today,
      today: this.daily[today] ?? this.recomputeDay(today),
      yesterday: this.daily[yesterday] ?? this.recomputeDay(yesterday),
      days: this.range(days),
      gates: this.gates.slice(-gateLimit).reverse(),
      health: this.health(),
      reconcile: this.reconcile(),
      updatedAt: this.now(),
    };
  }

  range(days = 14) {
    const out = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      out.push(this.daily[dayKey(this.now() - i * DAY, this.config)] ?? null);
    }
    return out;
  }

  /** 体检：采集有没有在跑、落后多少、她那边和这边对不对得上。 */
  health() {
    const size = byteSize(this.traceFile);
    return {
      ok: Boolean(this.lastPollAt) && this.now() - this.lastPollAt < this.config.pollMs * 3 && !this.lastError,
      running: this.timers.length > 0,
      traceFile: this.traceFile,
      traceBytes: size,
      offset: this.offset,
      backlog: Math.max(0, size - this.offset),
      lastPollAt: this.lastPollAt || null,
      pollAgeMs: this.lastPollAt ? this.now() - this.lastPollAt : null,
      lastError: this.lastError,
      startedAt: this.startedAt || null,
      turnsInMemory: this.turns.length,
      gatesInMemory: this.gates.length,
      timezone: this.config.timezone,
      dayBoundaryHour: this.config.dayBoundaryHour,
      reconcile: this.reconcile(),
    };
  }

  /**
   * 三源对账：chat.jsonl 里今天有几条他说的，traces.jsonl 里就该校出几条 say。
   * 缺口 > 0 说明有轮次没进透视（或读档时跳过），页面只报数，不猜原因。
   */
  reconcile() {
    const date = dayKey(this.now(), this.config);
    let chatUsers = 0;
    try {
      for (const line of readFileSync(this.chatFile, "utf8").split("\n")) {
        if (!line.trim()) continue;
        let row;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        if (row?.role !== "user" || row?.kind !== "say") continue;
        if (dayKey(Number(row.at) || 0, this.config) === date) chatUsers += 1;
      }
    } catch {
      chatUsers = 0;
    }
    const sayTurns = this.turnsFor(date).filter((turn) => turn.kind === "say").length;
    return { date, chatUsers, sayTurns, missing: Math.max(0, chatUsers - sayTurns) };
  }

  /** 给页面用的一次性快照（JSON 可序列化，不含正文）。 */
  snapshot() {
    return {
      ...this.summary(),
      turns: this.turns.slice(-80).reverse(),
    };
  }
}

function byteSize(path) {
  try {
    return readFileSync(path).length;
  } catch {
    return 0;
  }
}
