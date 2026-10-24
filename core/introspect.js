/**
 * core/introspect.js — 夜里的一次自省（纯函数）
 *
 * 私有版那一版会调模型写日记；公开版不调模型、不落叙事文本，
 * 只在夜里把**她已经有的东西**收拢成一小段：今天记下了什么、底色如何、还在想什么。
 * 这是「回顾」，不是「创作」——所以每一行都能在状态里找到出处。
 *
 * 边界：
 *   - 只在夜里（23:00–02:00，北京时间）出现，一晚只出现一次；
 *   - 没有素材就少写，不拿「今天也很平静」这种话凑数；
 *   - 不写日期、不写「总结一下」，也不替对方说话。
 */

/** 夜里从几点开始、到几点结束（分钟，北京时间）。 */
export const NIGHT_START = 23 * 60;
export const NIGHT_END = 2 * 60;

/** 北京时间当天是几点几分。 */
function minuteOfDay(ts) {
  const date = new Date(Number(ts) + 8 * 3_600_000);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

export function inNightWindow(ts) {
  const minute = minuteOfDay(ts);
  return minute >= NIGHT_START || minute < NIGHT_END;
}

/**
 * 这一晚的键：凌晨 0–2 点算「前一天晚上」，这样一晚只会自省一次。
 * @param {number} ts
 */
export function nightKey(ts = 0) {
  const date = new Date(Number(ts) + 8 * 3_600_000);
  if (date.getUTCHours() < NIGHT_END / 60) date.setUTCDate(date.getUTCDate() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** 这一晚该不该自省：在窗口里，且这一晚还没做过。 */
export function dueForReflection(ts, lastKey = "") {
  return inNightWindow(ts) && nightKey(ts) !== String(lastKey ?? "");
}

/**
 * 把现有的东西收成一小段自省。
 *
 * @param {object} params
 * @param {object} [params.snapshot] EmotionStore.snapshot() 的结果
 * @param {Array} [params.memories] 最近的记忆（已按时间倒序）
 * @param {Array} [params.beliefs]
 * @param {Array} [params.profile]
 * @param {number} [params.now]
 * @returns {{text: string, lines: string[]}}
 */
export function reflect({ snapshot = null, memories = [], beliefs = [], profile = [], now = 0 } = {}) {
  const lines = [];

  const recent = (Array.isArray(memories) ? memories : [])
    .map((item) => String(item?.text ?? "").trim())
    .filter(Boolean)
    .slice(0, 2);
  if (recent.length) lines.push(`今天你记下的：${recent.join("；")}。`);

  if (snapshot?.text || snapshot?.backgroundLabel) {
    const mood = snapshot.backgroundLabel
      ? `你的底色是${snapshot.backgroundLabel}${snapshot.primaryLabel ? `，这会儿${snapshot.primaryLabel}` : ""}`
      : String(snapshot.text).split("。")[0];
    if (mood) lines.push(`${mood}。`);
  }

  const belief = (Array.isArray(beliefs) ? beliefs : [])
    .filter((item) => Number(item?.confidence) >= 0.4)
    .sort((a, b) => Number(b.confidence) - Number(a.confidence))[0];
  if (belief) lines.push(`你还是觉得：${belief.topic}。`);

  const noticed = (Array.isArray(profile) ? profile : [])
    .filter((item) => Number(item?.confidence) >= 0.4)
    .sort((a, b) => Number(b.confidence) - Number(a.confidence))[0];
  if (noticed) lines.push(`你还在想：${noticed.value}——这到底算不算他的常态。`);

  if (!lines.length) return { text: "", lines: [] };
  return { text: `【夜里】\n${lines.join("\n")}`, lines };
}
