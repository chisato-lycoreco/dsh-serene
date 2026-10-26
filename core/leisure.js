/**
 * core/leisure.js — 消遣的那段时间（纯函数）
 *
 * 这一层只回答一个问题：**她坐着的那段到底有多长**。
 *
 * 别的都可以模糊（看了什么、好不好看），时长不行：十分钟「看完」一部两小时的片子，
 * 那条时间线自己就穿帮了。所以这里定了三条硬规矩：
 *
 *   1. 每类消遣有自己的一段时长（SPANS）；电影走真实片长（MOVIES / runtimeOf）；
 *   2. 电影只坐了其中一段（片长的 0.55–1.0 倍）——没看完，就不能写成看完了；
 *   3. 同一部片，正在看 / 看完了 / 只看了一半，说的是三句不同的话。
 *
 * 这里没有「她喜不喜欢」「值不值得再刷」——那是口味层的事，不往外搬。
 *
 * 和别处一样：不落盘、不调模型、不看时间；随机的部分全部由 seed 决定，
 * 同一个 seed 永远同一段时长、同一句话。
 */

/** 五类消遣。`tense` 是同一件事的三种说法：正在做 / 做完了 / 没做完。 */
export const KINDS = {
  video: { name: "看视频", tense: { now: "在看视频", done: "看了会儿视频", unfinished: "看了一半视频" } },
  movie: { name: "看电影", tense: { now: "在看电影", done: "看了部电影", unfinished: "看了半部电影" } },
  music: { name: "听歌", tense: { now: "在听歌", done: "听了会儿歌", unfinished: "听了一半" } },
  game: { name: "打游戏", tense: { now: "在打游戏", done: "打了会儿游戏", unfinished: "一局没打完" } },
  book: { name: "看书", tense: { now: "在看书", done: "看了会儿书", unfinished: "看了一半" } },
};

/**
 * 每类大概占多久（分钟）。**时间得是真的**：短视频是几条、听歌是几首，
 * 都不是随口一说。电影不在这张表里——它按片长走（见 runtimeOf）。
 */
export const SPANS = {
  video: [8, 25],
  music: [12, 40],
  game: [25, 70],
  book: [20, 55],
};

/** 认不出来的类就按看视频算：宁可普通，不要空。 */
const KIND_FALLBACK = "video";

/**
 * 公共版片单：只放已公映的经典片，`runtime` 是这部片真有多长（分钟）。
 * 不联网的「看电影」也得有个真名字，和真的坐得住的那段时间。
 */
export const MOVIES = [
  { title: "海上钢琴师", runtime: 165, year: 1998 },
  { title: "千与千寻", runtime: 125, year: 2001 },
  { title: "星际穿越", runtime: 169, year: 2014 },
  { title: "肖申克的救赎", runtime: 142, year: 1994 },
  { title: "教父", runtime: 175, year: 1972 },
  { title: "阿甘正传", runtime: 142, year: 1994 },
  { title: "盗梦空间", runtime: 148, year: 2010 },
  { title: "花样年华", runtime: 98, year: 2000 },
  { title: "一一", runtime: 173, year: 2000 },
  { title: "天堂电影院", runtime: 155, year: 1988 },
  { title: "龙猫", runtime: 86, year: 1988 },
  { title: "幽灵公主", runtime: 134, year: 1997 },
  { title: "霸王别姬", runtime: 171, year: 1993 },
  { title: "楚门的世界", runtime: 103, year: 1998 },
  { title: "这个杀手不太冷", runtime: 110, year: 1994 },
  { title: "美丽人生", runtime: 116, year: 1997 },
];

/** 片单外的片子（测试、以后换片单）按这个估。 */
const DEFAULT_RUNTIME = 95;
/** 电影实际坐着的比例：看不完就只算坐着的那段，不会凭空多出半小时。 */
const MOVIE_SHARE = [0.55, 1];
/** 看了这么多（含）才算看完：差着二十分钟就说看完了，时间线要穿帮。 */
const FINISHED_RATIO = 0.98;

/** FNV-1a：只要稳定，不求均匀。和 core/life.js 同一把尺子。 */
function hash(text) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** 把种子摊到 [0, 1)：同一个 seed 永远同一个数。 */
function unit(seed) {
  return (hash(String(seed)) % 10_000) / 10_000;
}

const pick = (list, seed) => list[hash(String(seed)) % list.length];

/** 认不出来的类归到 video；写记录、取文案都走这里，免得两处各判一次。 */
export function normalizeKind(kind) {
  const key = String(kind ?? "").trim();
  return Object.hasOwn(KINDS, key) ? key : KIND_FALLBACK;
}

/** 片单里这部多长；没写就按常见片长估。 */
export function runtimeOf(movie) {
  const value = Number(movie?.runtime);
  return Number.isFinite(value) && value >= 20 ? Math.round(value) : DEFAULT_RUNTIME;
}

/** 按 seed 从片单里挑一部——同一个 seed 永远同一部。 */
export function pickMovie(seed) {
  return pick(MOVIES, seed ?? "movie");
}

/**
 * 这一段她坐了多久（分钟）。
 *
 * 电影按片长的 0.55–1.0 倍：看得下去就坐满，看不下去就只算坐着的那段。
 * 别的类落在 SPANS 的档里。
 *
 * @param {string} kind
 * @param {string|number} [seed] 同一次抽签的种子；不传就按 kind 固定一段
 * @param {{runtime?: number}} [options] 片长（只有电影有）
 */
export function spanMinutes(kind, seed, { runtime = 0 } = {}) {
  const at = unit(seed ?? kind);
  const key = normalizeKind(kind);
  if (key === "movie") {
    const length = runtimeOf({ runtime });
    const [low, high] = MOVIE_SHARE;
    return Math.max(1, Math.round(length * (low + at * (high - low))));
  }
  const [min, max] = SPANS[key] ?? SPANS[KIND_FALLBACK];
  return Math.round(min + at * (max - min));
}

/**
 * 这一段算不算「看完了」。
 *
 * 电影按比例：实际看的分钟 ÷ 片长 ≥ 0.98 才算。别的类没有片长这回事，
 * 坐够了就算看完（记录里的 minutes 已经是她真坐的那段）。
 *
 * `seed` 只是和 spanMinutes 用同一个种子的调用方顺手传进来的；这个判定只按
 * 比例说话，不靠随机。
 *
 * @param {string} kind
 * @param {number} minutes 实际看的分钟
 * @param {{runtime?: number, seed?: string|number}} [options]
 */
export function finishedOf(kind, minutes, { runtime = 0 } = {}) {
  const watched = Number(minutes);
  if (!Number.isFinite(watched) || watched <= 0) return false;
  if (normalizeKind(kind) !== "movie") return true;
  return watched / runtimeOf({ runtime }) >= FINISHED_RATIO;
}

/**
 * 这件事用哪种说法。
 *
 * @param {string} kind
 * @param {"now"|"done"|"unfinished"} [tense]
 * @param {{resumed?: boolean}} [options] 接着上次没看完的那部看
 */
export function leisureLabel(kind, tense = "now", { resumed = false } = {}) {
  const key = normalizeKind(kind);
  const labels = KINDS[key].tense;
  if (key !== "movie") return labels[tense] ?? labels.now;
  if (tense === "now") return resumed ? "接着看电影" : labels.now;
  if (tense === "unfinished") return resumed ? "又没看完" : labels.unfinished;
  return resumed ? "把剩下的看完了" : labels.done;
}

/**
 * 把一串消遣截成互不重叠的时间线：后一件开始时，前一件就到点了。
 *
 * 按开始时间排序（不改入参，返回新数组）；截完长度归零的那段直接丢掉——
 * 那一刻已经被后一件占了，它没有真的发生。
 *
 * @param {Array<{start: number, end: number}>} spans
 * @returns {Array<{start: number, end: number}>}
 */
export function trimOverlaps(spans) {
  const list = (Array.isArray(spans) ? spans : [])
    .map((span) => ({ ...span, start: Number(span?.start), end: Number(span?.end) }))
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start)
    // 只按开始时间排（稳定排序）：同一刻开始的两段，后给的那段说了算。
    .sort((a, b) => a.start - b.start);

  const out = [];
  for (const span of list) {
    const previous = out[out.length - 1];
    if (previous && span.start < previous.end) previous.end = span.start;
    out.push({ ...span });
  }
  return out.filter((span) => span.end > span.start);
}

/** 这条记录她实际坐了多久：正在做的按已经过去的时间算，做完的按记录里的分钟。 */
function minutesOf(entry, at, open) {
  const startAt = Number(entry?.startAt);
  const endAt = Number(entry?.endAt);
  const planned = Number(entry?.minutes);
  if (open && Number.isFinite(startAt) && Number.isFinite(at)) {
    return Math.max(1, Math.round((at - startAt) / 60_000));
  }
  if (Number.isFinite(planned) && planned > 0) return Math.max(1, Math.round(planned));
  if (Number.isFinite(startAt) && Number.isFinite(endAt) && endAt > startAt) {
    return Math.max(1, Math.round((endAt - startAt) / 60_000));
  }
  return 1;
}

/**
 * 一条消遣 → 一句话，外加这件事到底看完没有。
 *
 * 三种说法各说各的：
 *   - 还没结束：`【手上】在看电影「海上钢琴师」，已经 40 分钟。`
 *   - 看完了：  `刚才看了部电影「海上钢琴师」，165 分钟。`
 *   - 没看完：  `刚才看了半部电影「海上钢琴师」，95 分钟。`（`unfinished: true`）
 *
 * @param {object} entry { kind, title, minutes, startAt, endAt, finished?, unfinished?, runtime?, resumed? }
 * @param {{now?: number, title?: string}} [options]
 * @returns {{text: string, unfinished: boolean, tense: string, kind: string, title: string, minutes: number}}
 */
export function leisureLine(entry, { now, title } = {}) {
  const at = Number(now);
  const kind = normalizeKind(entry?.kind);
  const startAt = Number(entry?.startAt);
  const endAt = Number(entry?.endAt);
  const open = Number.isFinite(endAt) && Number.isFinite(at) && endAt > at
    && (!Number.isFinite(startAt) || startAt <= at);
  const resumed = Boolean(entry?.resumed ?? entry?.resumeOf);
  const minutes = minutesOf(entry, at, open);
  const declared = typeof entry?.finished === "boolean"
    ? entry.finished
    : entry?.unfinished === true
      ? false
      : null;
  const finished = declared ?? finishedOf(kind, minutes, { runtime: entry?.runtime });
  const tense = open ? "now" : finished ? "done" : "unfinished";

  const name = String(title ?? entry?.title ?? "").trim();
  const named = name ? `「${name}」` : "";
  const label = leisureLabel(kind, tense, { resumed });
  const text = open
    ? `【手上】${label}${named}，已经 ${minutes} 分钟。`
    : `刚才${label}${named}，${minutes} 分钟。`;

  return { text, unfinished: tense === "unfinished", tense, kind, title: name, minutes };
}

/**
 * 一条消遣 → 一句 prompt 文本（不带结构）。
 *
 * 没看完的那条只会说「看了半部…」，**不会**出现「看完了」；要那个
 * `unfinished` 标记就传 `detailed: true`（拿 leisureLine 的完整结果），
 * 或者直接调 leisureLine——判定是同一个。
 *
 * @param {object} entry
 * @param {{now?: number, title?: string, detailed?: boolean}} [options]
 * @returns {string|{text: string, unfinished: boolean, tense: string, kind: string, title: string, minutes: number}}
 */
export function leisureBlock(entry, { detailed = false, ...options } = {}) {
  const line = leisureLine(entry, options);
  return detailed ? line : line.text;
}

export const __test__ = {
  hash,
  unit,
  pick,
  DEFAULT_RUNTIME,
  MOVIE_SHARE,
  FINISHED_RATIO,
  KIND_FALLBACK,
};
