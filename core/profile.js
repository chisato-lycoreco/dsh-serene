/**
 * core/profile.js — 她慢慢注意到的「他」（纯函数，种子为空）
 *
 * 这一层只搬机制，不带任何真实观察：新装的时候它是一张白纸，
 * 她注意到一点就记一点；没有观察时，prompt 里一个字都不出现。
 *
 * 六个维度是固定的（作息 / 口味 / 在意的事 / 说话习惯 / 情绪底色 / 对天气的反应），
 * 每个维度最多留几条，重复观察到同一个值只会让它更确定——不会越堆越多。
 *
 * 不落盘、不看时间、不调模型：`now` 由调用方给。
 */

/** 她观察的几个方面。键会落盘，中文只用于调试和报告。 */
export const DIMENSIONS = Object.freeze({
  rhythm: "作息",
  taste: "口味",
  matters: "在意的事",
  talk: "说话习惯",
  mood: "情绪底色",
  weather: "对天气的反应",
});

export const DIMENSION_KEYS = Object.freeze(Object.keys(DIMENSIONS));
/** 一个维度最多留几条不同的观察。 */
export const MAX_VALUES_PER_DIMENSION = 3;
/** 底气上限：观察再多，也留一点余地。 */
const MAX_CONFIDENCE = 0.9;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sentence = (value) => String(value ?? "").trim().replace(/[。.！!；;，,、\s]+$/, "");

/** 把盘上的观察收成标准形状；坏的维度 / 空值直接丢。 */
export function normalizeProfile(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const dimension = String(item?.dimension ?? "");
    const value = sentence(item?.value).slice(0, 40);
    if (!DIMENSION_KEYS.includes(dimension) || !value) continue;
    out.push({
      dimension,
      value,
      count: Math.max(1, Math.floor(Number(item?.count) || 1)),
      confidence: clamp(Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0.25, 0, MAX_CONFIDENCE),
      updatedAt: Number(item?.updatedAt) || 0,
    });
  }
  return out;
}

/**
 * 记一次观察。
 *
 * @param {Array} profile 现有观察
 * @param {object} input
 * @param {string} input.dimension 六个维度之一
 * @param {string} input.value 一句话，站在她的角度（「他睡得晚」）
 * @param {number} [input.weight] 这次的分量，默认 1
 * @param {number} [now]
 * @returns {{profile: Array, observation: object|null, changed: boolean, reason?: string}}
 */
export function observe(profile, { dimension, value, weight = 1, now = 0 } = {}) {
  const key = String(dimension ?? "").trim();
  const text = sentence(value).slice(0, 40);
  const base = normalizeProfile(profile);
  if (!DIMENSION_KEYS.includes(key)) return { profile: base, observation: null, changed: false, reason: "dimension" };
  if (!text) return { profile: base, observation: null, changed: false, reason: "value" };

  const next = base.slice();
  const index = next.findIndex((item) => item.dimension === key && item.value === text);
  const bump = clamp(Number(weight) || 1, 0.1, 3);

  let observation;
  if (index >= 0) {
    const old = next[index];
    observation = {
      ...old,
      count: old.count + 1,
      confidence: clamp(old.confidence + 0.12 * bump, 0, MAX_CONFIDENCE),
      updatedAt: Number(now) || old.updatedAt,
    };
    next[index] = observation;
  } else {
    observation = {
      dimension: key,
      value: text,
      count: 1,
      confidence: clamp(0.25 + 0.12 * bump, 0, MAX_CONFIDENCE),
      updatedAt: Number(now) || 0,
    };
    next.push(observation);
  }

  // 同一维度只留最确定的三条，旧的、弱的先走。
  const same = next.filter((item) => item.dimension === key).sort((a, b) => b.confidence - a.confidence || b.updatedAt - a.updatedAt);
  const keep = new Set(same.slice(0, MAX_VALUES_PER_DIMENSION));
  const kept = next.filter((item) => item.dimension !== key || keep.has(item));
  // 刚注意到的这条如果排不进前三，就不要假装记下了。
  if (!kept.includes(observation)) return { profile: kept, observation: null, changed: false, reason: "crowded" };
  return { profile: kept, observation, changed: true };
}

/**
 * 给 prompt 用的一句话：最确定的几条，跨维度各取一条。
 * 没有观察时返回空串（不写「你还不了解他」这种废话）。
 */
export function profileLine(profile, { limit = 3 } = {}) {
  const list = normalizeProfile(profile).sort(
    (a, b) => b.confidence - a.confidence || b.count - a.count || b.updatedAt - a.updatedAt,
  );
  const picked = [];
  const used = new Set();
  for (const item of list) {
    if (used.has(item.dimension)) continue;
    used.add(item.dimension);
    picked.push(item);
    if (picked.length >= limit) break;
  }
  if (!picked.length) return "";
  return `你注意到：${picked.map((item) => item.value).join("；")}。`;
}

/** 调试用：每个维度几条、最确定的是什么。 */
export function profileSummary(profile) {
  const list = normalizeProfile(profile);
  return DIMENSION_KEYS.map((key) => {
    const items = list.filter((item) => item.dimension === key);
    return { dimension: key, label: DIMENSIONS[key], count: items.length, top: items.sort((a, b) => b.confidence - a.confidence)[0] ?? null };
  }).filter((item) => item.count > 0);
}
