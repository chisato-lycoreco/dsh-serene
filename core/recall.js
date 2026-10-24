/**
 * core/recall.js — 记忆召回（纯函数）
 *
 * 两代口径并存，`MEMORY_CURVE` 选：
 *
 *   v1（0.1.x）  cue × (0.55 + 0.45 × 新鲜度) × (0.7 + 0.3 × 重要度)，有分就取前 k。
 *                问题是它一定会给出东西：平均 5.97 条、和这句话的相关度 0.05、
 *                最重的一条被反复注入——记忆不是想起来的，是钉在背景板上的。
 *
 *   v2（0.2.0）  激活度打分 + 确定性加权抽样，最多 6 条，**允许 0 条**。
 *                不补位；线索太弱的先淘汰；被召回会按间隔效应变牢。
 *
 * v2 的三条纪律：
 *   1. 可复算：同一条记忆的激活度、保持率、强化增益，都能用这里公开的公式重算；
 *   2. 可复现：抽样不用 Math.random，噪声来自 (id, 查询, 时间戳) 的哈希——
 *      同样的输入永远得到同样的结果，测试才钉得住；
 *   3. 不越权：心情只改「哪条更容易浮起来」，不改内容、不改真假，事实与知识不染。
 */

const CJK = /[\u4e00-\u9fff]/;
const DAY = 86_400_000;

/** 六类记忆。写的时候要选一类，召回/展示/淘汰都用得上。 */
export const MEMORY_KINDS = ["fact", "preference", "moment", "promise", "insight", "self"];

/** 单条上限：记忆是提炼，不是聊天记录。写不短，说明还没想清楚。 */
export const MAX_TEXT_CHARS = 80;

/** 长期记忆的容量预算。只增不减的记忆等于没有记忆。 */
export const MEMORY_CAPACITY = 500;

/** v2 的召回参数。改任何一个，都应该先问「可解释性还在不在」。 */
export const RECALL = Object.freeze({
  limit: 6,
  minCue: 0.12,
  floor: -1.2,
  noise: 0.4,
  cueWeight: 0.9,
  importanceWeight: 0.5,
  retentionWeight: 1.1,
  moodTint: 0.45,
  maxStabilityDays: 3650,
});

const unit = (value) => Math.max(0, Math.min(1, value));
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

/** 中英混排的分词：拉丁词按词切，中文按二元组切（不用词典也能匹配）。 */
export function tokenize(text) {
  const source = String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!source) return [];
  const tokens = [];
  const latin = source.match(/[a-z0-9_]{2,}/g) ?? [];
  tokens.push(...latin);
  for (const run of source.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length === 1) tokens.push(run);
    for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

/* ─────────────────────── v1：旧的衰减与打分 ─────────────────────── */

/** 时间衰减：默认 45 天半衰期——越久的事越难被主动想起，但不是不能想起。 */
export function recency(updatedAt, now = Date.now(), halfLifeDays = 45) {
  const age = Math.max(0, now - Number(updatedAt || 0)) / DAY;
  if (!Number.isFinite(age) || halfLifeDays <= 0) return 1;
  return 0.5 ** (age / halfLifeDays);
}

/** 关联强度：查询词在记忆里被覆盖了多少（0~1）。 */
export function cueScore(memory, queryTokens) {
  const tokens = new Set(tokenize(memory?.text ?? memory));
  if (!tokens.size || !queryTokens?.length) return 0;
  let hit = 0;
  for (const token of new Set(queryTokens)) if (tokens.has(token)) hit += 1;
  return Math.min(1, hit / Math.max(3, Math.sqrt(tokens.size)));
}

/**
 * 单条记忆的 v1 得分。
 *
 *   score = cue × (0.55 + 0.45 × recency) × (0.7 + 0.3 × importance)
 */
export function score(memory, queryTokens, now = Date.now(), { halfLifeDays = 45 } = {}) {
  const cue = cueScore(memory, queryTokens);
  if (cue <= 0) return 0;
  const important = Math.max(0, Math.min(1, Number(memory?.importance ?? 0.5)));
  return cue * (0.55 + 0.45 * recency(memory?.updatedAt ?? memory?.at, now, halfLifeDays)) * (0.7 + 0.3 * important);
}

/** v1 排序取前 k 条。分数相同按时间新到旧，保证结果可复现。 */
export function rank(memories, query, { limit = 5, now = Date.now(), halfLifeDays = 45 } = {}) {
  const queryTokens = Array.isArray(query) ? query : tokenize(query);
  if (!queryTokens.length) return [];
  return (Array.isArray(memories) ? memories : [])
    .map((memory) => ({ memory, score: score(memory, queryTokens, now, { halfLifeDays }) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.memory?.updatedAt ?? 0) - Number(a.memory?.updatedAt ?? 0))
    .slice(0, Math.max(1, limit))
    .map((item) => ({ ...item.memory, score: Math.round(item.score * 1000) / 1000 }));
}

/* ─────────────────────── v2：保持、稳定度、激活度 ─────────────────────── */

/**
 * 初始稳定度（天）：重要的记得牢，时刻与承诺再乘 1.3。
 * 1.5 + 6 × 重要性 → 0.5 的记忆约 4.5 天，0.9 的约 6.9 天。
 */
export function initialStability(memory) {
  const importance = unit(Number(memory?.importance ?? 0.5));
  const factor = memory?.kind === "moment" || memory?.kind === "promise" ? 1.3 : 1;
  return round((1.5 + 6 * importance) * factor, 3);
}

/** 这条记忆现在的稳定度；老数据没有就按写入时的公式现算（不需要迁移）。 */
export function stabilityOf(memory) {
  const value = Number(memory?.stability);
  if (Number.isFinite(value) && value > 0) return Math.min(RECALL.maxStabilityDays, value);
  return initialStability(memory);
}

/**
 * 保持率：先快后慢的遗忘曲线。
 *
 *   retention = (1 + 年龄 / 稳定度) ^ −0.6
 *
 * 年龄永远从**写入时间**算——被想起不重置「多久以前」，只让以后的衰减更慢。
 */
export function retention(memory, now = Date.now(), { createdAt } = {}) {
  const born = Number(createdAt ?? memory?.createdAt ?? memory?.updatedAt ?? now);
  const ageDays = Math.max(0, now - born) / DAY;
  const stability = stabilityOf(memory);
  return round((1 + ageDays / stability) ** -0.6, 6);
}

/** 心情染色：只给非事实、非知识类的记忆，±0.45。 */
export function moodTint(memory, mood = 0) {
  const value = Number(mood);
  if (!Number.isFinite(value) || value === 0) return 0;
  const kind = String(memory?.kind ?? "fact");
  const tags = Array.isArray(memory?.tags) ? memory.tags.join(",") : "";
  if (kind === "fact" || /知识|knowledge/i.test(tags)) return 0;
  return RECALL.moodTint * Math.max(-1, Math.min(1, value));
}

/* 确定性噪声：FNV-1a 32 位 → [0,1)，不用 Math.random。 */
function hash32(text) {
  let hash = 0x811c9dc5;
  const source = String(text);
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hashUnit(text) {
  return (hash32(text) % 1_000_003 + 1) / 1_000_004;
}

/** Gumbel 噪声：把「加权抽样」写成一次可复算的排序。 */
function gumbel(text) {
  const value = hashUnit(text);
  return -Math.log(-Math.log(value));
}

/**
 * 一条记忆的激活度（v2）。
 *
 *   activation = 1.1·ln(保持 + 0.02) + 0.9·线索 + 0.5·重要度 + 心情染色 + 0.4·Gumbel(seed)
 *
 * 线索低于 minCue 直接出局（返回 −Infinity），不参与抽样。
 * Gumbel 的 seed 只由 (id, 查询词, 时间戳) 决定：同样的输入，同样的结果。
 */
export function activationOf(memory, queryTokens, now = Date.now(), { mood = 0, minCue = RECALL.minCue } = {}) {
  const cue = cueScore(memory, queryTokens);
  if (cue < minCue) return -Infinity;
  const keep = retention(memory, now);
  const important = unit(Number(memory?.importance ?? 0.5));
  const seed = `${memory?.id ?? memory?.text ?? ""}|${[...new Set(queryTokens)].sort().join(",")}|${now}`;
  return round(
    RECALL.retentionWeight * Math.log(keep + 0.02) +
      RECALL.cueWeight * cue +
      RECALL.importanceWeight * important +
      moodTint(memory, mood) +
      RECALL.noise * gumbel(seed),
    6,
  );
}

/**
 * v2 召回：激活度排序，取前 k 条，不足不补。
 *
 * @returns 允许空数组。每条带 score（激活度）、cue、retention，方便解释「为什么是它」。
 */
export function activate(
  memories,
  query,
  { limit = RECALL.limit, now = Date.now(), mood = 0, minCue = RECALL.minCue, floor = RECALL.floor } = {},
) {
  const queryTokens = Array.isArray(query) ? query : tokenize(query);
  if (!queryTokens.length) return [];
  return (Array.isArray(memories) ? memories : [])
    .map((memory) => ({
      memory,
      score: activationOf(memory, queryTokens, now, { mood, minCue }),
      cue: cueScore(memory, queryTokens),
      retention: retention(memory, now),
    }))
    .filter((item) => Number.isFinite(item.score) && item.score >= floor)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.memory?.createdAt ?? 0) - Number(a.memory?.createdAt ?? 0) ||
        String(a.memory?.id ?? "").localeCompare(String(b.memory?.id ?? "")),
    )
    .slice(0, Math.max(0, Math.min(RECALL.limit * 2, limit)))
    .map((item) => ({
      ...item.memory,
      score: round(item.score, 3),
      cue: round(item.cue, 3),
      retention: round(item.retention, 3),
    }));
}

/**
 * 「被想起会真的变牢」：按间隔效应抬高稳定度。
 *
 *   r = (1 + 间隔 / 稳定度) ^ −0.6      （间隔天）
 *   S' = S × (1 + 1.2 × (1 − r))       （封顶 10 年）
 *
 * 同一刻连着想两次 r≈1，几乎不长；隔一阵再想起来才明显——这是间隔效应本身，
 * 不是 bug。年龄仍从写入时间算，`updatedAt` 不动。
 */
export function reinforce(memory, { now = Date.now() } = {}) {
  const stability = stabilityOf(memory);
  const last = Number(memory?.lastRecall);
  const born = Number(memory?.createdAt ?? memory?.updatedAt ?? now);
  const since = Number.isFinite(last) && last > 0 ? last : born;
  const gapDays = Math.max(0, now - since) / DAY;
  const r = (1 + gapDays / stability) ** -0.6;
  const next = Math.min(RECALL.maxStabilityDays, stability * (1 + 1.2 * (1 - r)));
  return {
    id: memory?.id,
    stability: round(next, 3),
    lastRecall: now,
    recallCount: Math.max(0, Number(memory?.recallCount) || 0) + 1,
    gain: round(next / stability, 4),
    intervalEffect: round(r, 4),
  };
}

/* ─────────────────────── 写入归一化 ─────────────────────── */

const textHash = (text) => hash32(text).toString(36).slice(0, 5);

/** 写入前归一化：只保留需要落盘的字段。 */
export function normalizeMemory(input, { now = Date.now(), maxChars = MAX_TEXT_CHARS } = {}) {
  const raw = String(input?.text ?? "").trim();
  if (!raw) return null;
  const chars = Array.from(raw);
  const text = Number.isFinite(maxChars) ? chars.slice(0, Math.max(1, maxChars)).join("") : raw;
  const kind = MEMORY_KINDS.includes(input?.kind) ? input.kind : "fact";
  const importance = unit(Number(input?.importance ?? 0.5));
  const createdAt = Number(input?.createdAt) || now;
  const id =
    String(input?.id ?? "").trim() ||
    `m_${createdAt.toString(36)}_${textHash(`${text}|${createdAt}|${kind}`)}`;
  const validUntil = Number(input?.validUntil);
  return {
    id,
    kind,
    text,
    tags: Array.isArray(input?.tags) ? input.tags.map(String).slice(0, 8) : [],
    importance,
    createdAt,
    updatedAt: Number(input?.updatedAt) || createdAt,
    source: String(input?.source ?? "chat"),
    validUntil: Number.isFinite(validUntil) && validUntil > 0 ? validUntil : null,
    stability: Number.isFinite(Number(input?.stability)) ? Number(input.stability) : initialStability({ importance, kind }),
    lastRecall: Number(input?.lastRecall) || 0,
    recallCount: Math.max(0, Number(input?.recallCount) || 0),
  };
}

export { CJK };
