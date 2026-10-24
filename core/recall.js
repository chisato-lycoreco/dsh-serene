/**
 * core/recall.js — 记忆召回打分（纯函数）
 *
 * 一个刻意做小的参考实现：没有向量、没有模型调用，只有
 * 词面重合 + 时间衰减 + 重要度。它的价值不在精度，而在**可解释**：
 * 任何一条记忆为什么被召回，都能用同样的公式复算一遍。
 *
 * 想换更强的召回（embedding / BM25 / 外部记忆服务）时，
 * 只要保持 rank() 的输入输出形状，其余代码不用动。
 */

const CJK = /[\u4e00-\u9fff]/;
const DAY = 86_400_000;

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
 * 单条记忆的得分。
 *
 *   score = cue × (0.55 + 0.45 × recency) × (0.7 + 0.3 × importance)
 *
 * importance 是写入时给的 0~1，默认 0.5；情绪强烈的记忆可以给高一点。
 */
export function score(memory, queryTokens, now = Date.now(), { halfLifeDays = 45 } = {}) {
  const cue = cueScore(memory, queryTokens);
  if (cue <= 0) return 0;
  const important = Math.max(0, Math.min(1, Number(memory?.importance ?? 0.5)));
  return cue * (0.55 + 0.45 * recency(memory?.updatedAt ?? memory?.at, now, halfLifeDays)) * (0.7 + 0.3 * important);
}

/** 排序取前 k 条。分数相同按时间新到旧，保证结果可复现。 */
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

/** 写入前归一化：只保留需要落盘的字段。 */
export function normalizeMemory(input, { now = Date.now() } = {}) {
  const text = String(input?.text ?? "").trim();
  if (!text) return null;
  return {
    id: input?.id ?? `m_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    text,
    tags: Array.isArray(input?.tags) ? input.tags.map(String).slice(0, 8) : [],
    importance: Math.max(0, Math.min(1, Number(input?.importance ?? 0.5))),
    createdAt: Number(input?.createdAt) || now,
    updatedAt: Number(input?.updatedAt) || now,
    source: String(input?.source ?? "chat"),
  };
}

export { CJK };
