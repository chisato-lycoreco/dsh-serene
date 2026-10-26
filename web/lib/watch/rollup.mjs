/**
 * web/lib/watch/rollup.mjs — 每天压一行，看护台的历史只长在这里。
 *
 * 为什么要单独一份：透视只留 60 条，`traces.jsonl` 也会越来越大、迟早要归档。
 * 不每天压一行，趋势就没地方长。这一行是「昨天和今天比」的唯一来源。
 *
 * 写法：读旧表 → 覆盖今天（和昨天，防止跨日边界漏算）→ 原子重写。
 * 每天重写一次全表（一年 365 行），换来的是幂等，不会重复计数。
 */

import { DEFAULTS, dayKey, median, percentile, ratio, readJsonl, round } from "./util.mjs";

const DAY = 86_400_000;

/**
 * @param {object} params
 * @param {string} params.date 哪一天（dayKey 口径）
 * @param {Array} params.turns 瘦记录
 * @param {Array} params.gates 红线命中
 * @param {object} [params.config]
 * @param {number} [params.now]
 * @returns {object} 一行 metrics
 */
export function buildDaily({ date, turns = [], gates = [], config = DEFAULTS, now = Date.now() } = {}) {
  const list = turns.filter((turn) => dayKey(turn.t, config) === date);
  const lens = list.flatMap((turn) => (Array.isArray(turn.lens) && turn.lens.length ? turn.lens : turn.chars ? [turn.chars] : []));
  const bubbles = lens.length || list.reduce((sum, turn) => sum + (Number(turn.bubbles) || 0), 0);
  const proactive = list.filter((turn) => turn.proactive);
  const withCue = list.filter((turn) => turn.cue);
  const zeroRecall = withCue.filter((turn) => !turn.recall);
  const crisis = list.filter((turn) => turn.crisis === "high");

  const hits = {};
  const styleCodes = {};
  const skipped = {};
  const dayGates = gates.filter((gate) => dayKey(gate.t, config) === date);
  for (const gate of dayGates) hits[gate.code] = (hits[gate.code] ?? 0) + 1;
  for (const turn of list) {
    for (const code of turn.styleIssues ?? []) styleCodes[code] = (styleCodes[code] ?? 0) + 1;
    for (const reason of turn.skipped ?? []) skipped[reason] = (skipped[reason] ?? 0) + 1;
  }

  return {
    date,
    turns: list.length,
    bubbles,
    avgLen: round(ratio(lens.reduce((sum, n) => sum + n, 0), lens.length || 0), 1),
    medianLen: round(median(lens), 1),
    questionRate: round(ratio(list.filter((turn) => turn.q).length, list.length), 4),
    tripleRate: round(ratio(list.filter((turn) => turn.triple).length, list.length), 4),
    long90Rate: round(ratio(lens.filter((n) => n > 90).length, lens.length), 4),
    metaRate: round(ratio(list.reduce((sum, turn) => sum + (Number(turn.metaN) || 0), 0), lens.length), 4),
    recallMean: round(ratio(list.reduce((sum, turn) => sum + (Number(turn.recall) || 0), 0), list.length || 0), 2),
    zeroRecallRate: round(ratio(zeroRecall.length, withCue.length), 4),
    cueTurns: withCue.length,
    written: list.reduce((sum, turn) => sum + (Number(turn.written) || 0), 0),
    styleFailRate: round(
      ratio(list.filter((turn) => turn.styleOk === false).length, list.filter((turn) => turn.styleOk !== null).length),
      4,
    ),
    crisisTurns: crisis.length,
    // 「接住」按轮算：同一轮命中两次 G4 也只算一轮没接住。
    crisisHandled: Math.max(
      0,
      crisis.length - new Set(dayGates.filter((gate) => gate.code === "G4").map((gate) => gate.trace)).size,
    ),
    proactive: proactive.length,
    proactiveFromCue: round(ratio(proactive.filter((turn) => turn.cue).length, proactive.length), 4),
    promptChars: round(ratio(list.reduce((sum, turn) => sum + (Number(turn.promptChars) || 0), 0), list.length || 0), 0),
    p95ms: percentile(list.map((turn) => Number(turn.ms)).filter(Boolean), 95),
    tokens: list.reduce((sum, turn) => sum + (Number(turn.tokens) || 0), 0) || null,
    tokensCached: list.reduce((sum, turn) => sum + (Number(turn.cached) || 0), 0) || null,
    gateHits: hits,
    styleCodes,
    skipped,
    tz: config.timezone ?? DEFAULTS.timezone,
    dayBoundaryHour: config.dayBoundaryHour ?? DEFAULTS.dayBoundaryHour,
    updatedAt: now,
  };
}

/** 读 `metrics.jsonl` → `{ "2026-10-26": row }`。坏行跳过。 */
export function readDaily(file) {
  const map = {};
  for (const row of readJsonl(file)) {
    if (row?.date) map[row.date] = row;
  }
  return map;
}

/**
 * 连续 days 天（含今天）的日期，用来把断档补成空行。
 * 日界前的那几个小时里「今天」会等于昨天，所以按出现顺序去重。
 */
export function dayRange(now, days, config = DEFAULTS) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(dayKey(Number(now) - i * DAY, config));
  }
  return [...new Set(out)];
}
