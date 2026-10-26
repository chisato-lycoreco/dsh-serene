/**
 * core/doing.js — 她手上那件、和刚才那几件（纯函数）
 *
 * 为什么要有这一层：他问「你在干嘛」，她答不上来，因为手上那件事在 prompt 里
 * 被「在听你说话」顶掉了。这一层只把真发生过的事摊成两句：
 * 现在手上是什么、刚才放下的是什么。
 *
 * 三条规矩：
 *   1. **正在进行的消遣优先**。带 `endAt` 的消遣按它自己的时长算「手上」——
 *      一部两小时的片子不会因为过了二十五分钟就被说成已经放下了；
 *      没带 `endAt` 的老记录才用 25 分钟的新鲜度兜底，再久就是刚放下了。
 *   2. **不编**。手上没有消遣就按 core/life.js 的作息说此刻（睡觉就说在睡）；
 *      两样都没有，返回空串，prompt 里就不出现这一段。
 *   3. **不看时钟**。`now` 必须由调用方传进来，同一组入参永远同一个结果。
 */

import { leisureLabel, normalizeKind } from "./leisure.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** 「刚才」只回看这么久；再早的事该由「今天的生活」去说，不往这一段里塞。 */
const RECENT_WINDOW = 4 * HOUR;
/** 没带 endAt 的消遣，只有这么新才算「手上」。 */
const LEISURE_HOLD = 25 * MINUTE;
/** 「刚才」最多两条：一条手上、两条刚才，再多就成了汇报。 */
const BEFORE_LIMIT = 2;

/** 这条消遣是什么时候发生的。store 写的是 at，老记录可能只有 startAt / ts。 */
function timeOf(item) {
  const at = Number(item?.at);
  if (Number.isFinite(at)) return at;
  const startAt = Number(item?.startAt);
  if (Number.isFinite(startAt)) return startAt;
  return Number(item?.ts);
}

/** 到什么时候结束。没带 endAt 的记录就当开始即结束，只能按新鲜度兜底。 */
function endOf(item) {
  const endAt = Number(item?.endAt);
  return Number.isFinite(endAt) ? endAt : timeOf(item);
}

/** 正在进行的消遣：带 endAt 的按它自己的时长，没带的按 25 分钟。 */
function currentLeisure(items, now) {
  const open = [];
  for (const item of items) {
    const at = timeOf(item);
    if (!Number.isFinite(at) || at > now) continue;
    const endAt = Number(item?.endAt);
    if (Number.isFinite(endAt)) {
      if (now < endAt) open.push({ item, at });
    } else if (now - at <= LEISURE_HOLD) {
      open.push({ item, at });
    }
  }
  open.sort((a, b) => a.at - b.at);
  return open.at(-1)?.item ?? null;
}

/** 手上没有消遣时，用作息说此刻；睡着了就说在睡。 */
function lifeState(life) {
  if (!life) return null;
  if (life.asleep) return { label: "在睡觉", detail: "", kind: "sleep" };
  const label = String(life.label ?? life.activity ?? "").trim();
  if (!label) return null;
  return { label, detail: String(life.place ?? "").trim(), kind: "life" };
}

/** 「刚才」：已经结束的消遣 + 调用方补进来的那几条，只留四小时内、最多两条。 */
function recentList({ items, before, now, current }) {
  const candidates = [];

  for (const item of items) {
    if (item === current) continue;
    const at = timeOf(item);
    const end = endOf(item);
    if (!Number.isFinite(at) || !Number.isFinite(end)) continue;
    if (now < end) continue;
    if (now - end > RECENT_WINDOW) continue;
    const finished = item?.finished !== false && item?.unfinished !== true;
    candidates.push({
      at: end,
      label: leisureLabel(item?.kind, finished ? "done" : "unfinished", {
        resumed: Boolean(item?.resumed ?? item?.resumeOf),
      }),
      detail: String(item?.title ?? "").trim(),
    });
  }

  for (const item of Array.isArray(before) ? before : []) {
    const at = Number(item?.at);
    if (!Number.isFinite(at) || at > now) continue;
    if (now - at > RECENT_WINDOW) continue;
    // 睡着了、在听人说话都不是「刚才做过的事」。
    if (item?.kind === "sleep" || item?.kind === "attending") continue;
    const label = String(item?.label ?? "").trim();
    if (!label) continue;
    candidates.push({ at, label, detail: String(item?.detail ?? "").trim() });
  }

  candidates.sort((a, b) => b.at - a.at);
  const out = [];
  const seen = new Set();
  for (const item of candidates) {
    const key = `${item.label}|${item.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= BEFORE_LIMIT) break;
  }
  return out;
}

/**
 * 她此刻的那两行数据。
 *
 * @param {object} [options]
 * @param {object|null} [options.life] `lifeAt(now)` 的结果（有 label / phase / asleep）
 * @param {object[]} [options.leisure] 消遣记录（`LeisureStore.all()`）
 * @param {Array<{label: string, detail: string, at: number}>} [options.before] 别处补进来的「刚才」
 * @param {number} options.now 此刻（必传：这一层不看时钟）
 * @returns {{now: {label: string, detail: string, kind: string}|null,
 *   before: Array<{label: string, detail: string, at: number}>}}
 */
export function doingView({ life = null, leisure = [], before = [], now } = {}) {
  const at = Number(now);
  if (!Number.isFinite(at)) throw new Error("doingView 需要 now：这一层不看时钟。");

  const items = Array.isArray(leisure) ? leisure : [];
  // 睡着了就没有「手上」：记录里那条还没到点的，是她本来打算看的。
  const current = life?.asleep ? null : currentLeisure(items, at);
  const nowItem = current
    ? {
        label: leisureLabel(current.kind, "now", { resumed: Boolean(current.resumed ?? current.resumeOf) }),
        detail: String(current.title ?? "").trim(),
        kind: normalizeKind(current.kind),
      }
    : lifeState(life);

  return { now: nowItem, before: recentList({ items, before, now: at, current }) };
}

/**
 * 一条现在/刚才怎么念：消遣带名字，作息只说手上这件。
 * 地点归生活卡去说（`lifeBlock` 里已经有了），这儿再补一句「（屋里）」只是重复。
 */
function phrase(item) {
  const detail = String(item.detail ?? "").trim();
  if (!detail || item.kind === "life" || item.kind === "sleep") return item.label;
  return `${item.label}「${detail}」`;
}

/**
 * 拼成一行中文（「【手上】…；【刚才】…」）。没有内容返回空串。
 *
 * @param {ReturnType<typeof doingView>} view
 * @returns {string}
 */
export function doingBlock(view) {
  if (!view) return "";
  const now = view.now?.label ? phrase(view.now) : "";
  const before = (Array.isArray(view.before) ? view.before : [])
    .filter((item) => item?.label)
    .map(phrase);
  const parts = [];
  if (now) parts.push(`【手上】${now}`);
  if (before.length > 0) parts.push(`【刚才】${before.join("；")}`);
  return parts.length > 0 ? `${parts.join("；")}。` : "";
}

export const __test__ = { MINUTE, RECENT_WINDOW, LEISURE_HOLD, BEFORE_LIMIT, timeOf, endOf };
