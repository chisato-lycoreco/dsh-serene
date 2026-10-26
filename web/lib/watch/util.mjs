/**
 * web/lib/watch/util.mjs — 看护台的公共件：路径、日界、落盘、统计。
 *
 * 约定和 core/ 一样，但这一层允许碰文件系统（它本来就是读盘的）：
 *   - 零外部依赖；
 *   - 只追加的 JSONL 走 appendJsonl，会被重写的快照走 writeJsonAtomic；
 *   - 所有「哪一天」都走 dayKey()，日界默认 04:00 Asia/Shanghai——
 *     她的夜里活动不该被 00:00 切成两半。
 *
 * 看护台只读她的数据，自己不写任何会影响她的文件：产物全部落在
 * `<dataDir>/watch/` 里，删掉这一层她照常说话。
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

/** 看护台的人为约定：日界、时区、多久采一次。 */
export const DEFAULTS = Object.freeze({
  timezone: "Asia/Shanghai",
  dayBoundaryHour: 4,
  pollMs: 20_000,
  rollupMs: 5 * 60_000,
  keepDays: 3,
  maxSeen: 2000,
});

/** 看护台的全部落点。传 dataDir（人格分桶目录）进来，不传就用调用方的 cwd。 */
export function watchPaths(dataDir) {
  const root = join(resolve(dataDir), "watch");
  return {
    root,
    turnsDir: join(root, "turns"),
    gatesFile: join(root, "gates.jsonl"),
    cardsFile: join(root, "cards.jsonl"),
    metricsFile: join(root, "metrics.jsonl"),
    cursorFile: join(root, "cursor.json"),
    logFile: join(root, "watch.log"),
  };
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(path, value) {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function appendJsonl(path, record) {
  ensureDir(dirname(path));
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

/**
 * 整份重写一个 JSONL（每日压表用）。
 * 先写临时文件再换名：中途被杀也不会留下半张表。
 */
export function writeLinesAtomic(path, rows) {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  renameSync(tmp, path);
}

export function readJsonl(path, limit = 0) {
  if (!existsSync(path)) return [];
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const lines = text.split("\n").filter((line) => line.trim());
  const slice = limit > 0 ? lines.slice(-limit) : lines;
  const out = [];
  for (const line of slice) {
    try {
      out.push(JSON.parse(line));
    } catch {
      /* 半行（写到一半被杀）跳过，不因为一行坏掉整份 */
    }
  }
  return out;
}

export function fileSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** 日界 04:00：把一个时间戳归到「哪一天」。 */
export function dayKey(ts, config = DEFAULTS) {
  const shift = (config.dayBoundaryHour ?? DEFAULTS.dayBoundaryHour) * 3_600_000;
  const timeZone = config.timezone ?? DEFAULTS.timezone;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Number(ts) - shift));
}

export function clock(ts, config = DEFAULTS) {
  const timeZone = config.timezone ?? DEFAULTS.timezone;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(Number(ts)));
}

export function median(values) {
  const list = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

export function percentile(values, p) {
  const list = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!list.length) return null;
  const index = Math.min(list.length - 1, Math.max(0, Math.ceil((p / 100) * list.length) - 1));
  return list[index];
}

export function ratio(part, whole) {
  return whole > 0 ? part / whole : null;
}

export function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** 证据只留一小段：够指认，不够复述。 */
export function safeText(value, max = 40) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 看护台自己的日志：写不动也不能反过来拖垮采集。 */
export function logLine(path, message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    ensureDir(dirname(path));
    appendFileSync(path, `${line}\n`, "utf8");
  } catch {
    /* 日志写不动就算了 */
  }
}
