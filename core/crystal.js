/**
 * core/crystal.js — 结晶层：经验（L3）与想事情的路子（L4）
 *
 * 记忆回答「发生了什么」，看法回答「我怎么看」，这一层回答另外两个问题：
 *   - 经验：**这么做有没有用**。形状是「这种时候 → 我做了什么 → 结果 → 下回怎么办」。
 *     唯一的合法来源是**后果**，不是聊完总结。所以每条都必须带 ≥2 个证据和一条反证。
 *   - 想事情的路子：**注意力落在哪儿**。不是内容，是习惯。
 *     条数极少（≤8），只从反复出现的行为里读出来，不让她自己「总结我的性格」。
 *
 * 三道闸门写在代码里，不靠 prompt 自觉：
 *   1. 证据闸门：`evidence` 少于 2 条不收；
 *   2. 可证伪闸门：`counter`（什么情况下这条不成立）为空不收；
 *   3. 陌生人闸门：主语换成谁都能说的，是口号不是经验——见 `isPlatitude()`。
 *
 * 出口纪律：
 *   - L4 **一般不说出口**，只有他主动问起才认；进 prompt 时头部写「不是台词」。
 *   - L3 每轮最多 1 条，只在句子里出现触发词时进；进去也不解释、不讲道理。
 *
 * 纯函数：不看钟、不读盘、不联网。`now` 由调用方传，同样的输入永远得到同样的输出。
 */

/** 两个文件名（数据目录下）。 */
export const LESSONS_FILE = "lessons.jsonl";
export const DISPOSITIONS_FILE = "dispositions.json";

/** 上限：经验 20 条、想事情的路子 8 条。 */
export const MAX_LESSONS = 20;
export const MAX_DISPOSITIONS = 8;

/** `result` 只有这三种；写错当 mixed（有得有失，别装作学到了）。 */
export const LESSON_RESULTS = Object.freeze(["worked", "failed", "mixed"]);

/**
 * 一条经验能押的后果（P2.5 的兼容字段）。这一版不产生、也不结算，
 * 但从私人仓库搬过来的 `lessons.jsonl` 里可能带着，原样保留。
 */
export const PREDICT_KINDS = Object.freeze(["caught", "brushed"]);

/** 经验的三种状态。`merged` 是 P3 的兼容状态：不删，只是不再进 prompt。 */
export const LESSON_STATUSES = Object.freeze(["active", "retired", "merged"]);

/** 想事情的路子的三种状态。`revoked` 是撤销：不删，降回「作废」。 */
export const DISPOSITION_STATUSES = Object.freeze(["active", "retired", "revoked"]);

/** 这一块在 prompt 里的字数上限；和 README 里的预算表共用一个数。 */
export const BLOCK_BUDGET = 240;

/** 经验上记「已经结过账」的动作 id，留多少条（兼容 P2.5）。 */
export const APPLIED_LIMIT = 400;

/** 一条经验渲染成一行时的上限。 */
export const LESSON_LINE_MAX = 72;

/** 想事情的路子最多写几条、正文最多多少字。 */
export const DISPOSITION_ITEMS = 5;
export const DISPOSITION_BODY_MAX = 104;

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const clean = (value, max) => [...String(value ?? "").replace(/\s+/g, " ").trim()].slice(0, max).join("");
const int = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback);

/** 稳定 id：同一条内容反复规整，id 不该变。 */
const hash = (text) => {
  let value = 5381;
  for (const char of String(text ?? "")) value = ((value << 5) + value + char.codePointAt(0)) >>> 0;
  return value.toString(36);
};

/* ─────────────────────── 闸门三：陌生人测试 ─────────────────────── */

/**
 * 口号识别（启发式，不是判定器）。
 *
 * 一句话里没有任何**具体的人、事、动作**，只剩「沟通 / 理解 / 珍惜 / 每个人」这类
 * 主语可以随便换的词，那它就不是她试出来的，是模板。命中的条目除非 `ownerApproved`，
 * 否则 `lessonIssues()` 会挂 `platitude`，进不了 prompt。
 */
const PLATITUDE_PATTERNS = [
  /(沟通|理解|信任|陪伴|包容|珍惜|真诚|坦率)[^，。]{0,8}(很重要|最重要|才是|才能|是关键)/,
  /^(沟通|理解|信任|陪伴|包容|珍惜)/,
  /每个人(都|的)/,
  /要学会/,
  /都应该/,
  /时间会(证明|给出)/,
  /多(沟通|理解|包容|体谅)/,
  /只要[^，。]{0,12}(就|都)(能|会|可以)/,
  /(相互|彼此)(理解|尊重|信任)/,
];

/** 这段文字像不像一句谁都能说的口号。 */
export function isPlatitude(text) {
  const body = String(text ?? "").replace(/\s+/g, "");
  if (!body) return true;
  return PLATITUDE_PATTERNS.some((pattern) => pattern.test(body));
}

/* ─────────────────────── 经验 ─────────────────────── */

/**
 * 一条经验规整成固定形状。缺字段不抛错，交给 `lessonIssues()` 去挂。
 *
 * P2.5 / P3 的字段（`cases`、`predict`、`tests`、`misses`、`applied`、`settledAt`、
 * `mergedInto`）这一版不产生也不结算，只原样保留：从私人仓库搬过来的数据不该在
 * 路上掉东西，以后要接账本也不用再改一遍形状。
 *
 * @param {object} raw
 * @param {{now?: number, source?: string}} [options]
 */
export function normalizeLesson(raw, { now = 0, source = "seed" } = {}) {
  const situation = clean(raw?.situation, 48);
  const did = clean(raw?.did ?? raw?.action, 48);
  const outcome = clean(raw?.outcome, 60);
  const next = clean(raw?.next, 50);
  const counter = clean(raw?.counter, 60);
  const evidence = (Array.isArray(raw?.evidence) ? raw.evidence : [])
    .map((item) => clean(item, 48))
    .filter(Boolean)
    .slice(0, 6);
  const when = (Array.isArray(raw?.when) ? raw.when : [])
    .map((item) => clean(item, 10))
    .filter(Boolean)
    .slice(0, 6);
  const cases = (Array.isArray(raw?.cases) ? raw.cases : [])
    .map((item) => ({ when: clean(item?.when, 16), next: clean(item?.next, 50) }))
    .filter((item) => item.when && item.next)
    .slice(0, 3);
  const misses = (Array.isArray(raw?.misses) ? raw.misses : [])
    .map((item) => clean(item, 48))
    .filter(Boolean)
    .slice(-5);
  const applied = (Array.isArray(raw?.applied) ? raw.applied : [])
    .map((item) => clean(item, 48))
    .filter(Boolean)
    .slice(-APPLIED_LIMIT);
  const predict = PREDICT_KINDS.includes(raw?.predict?.kind)
    ? { kind: raw.predict.kind, claim: clean(raw.predict.claim, 40) }
    : null;
  return {
    id: clean(raw?.id, 40) || `ls_${hash(`${situation}|${did}`)}`,
    situation,
    did,
    outcome,
    result: LESSON_RESULTS.includes(raw?.result) ? raw.result : "mixed",
    next,
    counter,
    when,
    evidence,
    cases,
    predict,
    confidence: clamp(raw?.confidence ?? 0.5, 0.2, 0.95),
    hits: Math.max(0, int(raw?.hits)),
    tests: Math.max(0, int(raw?.tests)),
    misses,
    applied,
    createdAt: int(raw?.createdAt, now) || now,
    lastHit: int(raw?.lastHit, 0),
    settledAt: int(raw?.settledAt, 0),
    status: LESSON_STATUSES.includes(raw?.status) ? raw.status : "active",
    retiredReason: clean(raw?.retiredReason, 40),
    mergedInto: clean(raw?.mergedInto, 40),
    source: clean(raw?.source ?? source, 16) || "seed",
    ownerApproved: raw?.ownerApproved === true,
    history: Array.isArray(raw?.history) ? raw.history.slice(0, 5) : [],
  };
}

/**
 * 这条经验还差什么。
 *
 * @returns {string[]} 缺口的代号；空数组 = 可以进 prompt。
 */
export function lessonIssues(lesson) {
  const issues = [];
  if (!lesson?.situation || !lesson?.did) issues.push("incomplete");
  if (!lesson?.outcome) issues.push("no_outcome");
  if (!lesson?.next) issues.push("no_next");
  if ((lesson?.evidence?.length ?? 0) < 2) issues.push("no_evidence");
  if (!lesson?.counter) issues.push("no_counter");
  if ([...(lesson?.next ?? "")].length > 50) issues.push("too_long");
  const body = [lesson?.situation, lesson?.did, lesson?.outcome, lesson?.next].join("");
  if (body && !lesson?.ownerApproved && isPlatitude(body)) issues.push("platitude");
  return issues;
}

/** 过了三道闸门没有。 */
export const isLessonReady = (lesson) => lessonIssues(lesson).length === 0;

/**
 * 这一轮该不该想起某条经验。
 *
 * 先看触发词（他这句话里出现了 `when` 里的词），没有再退回字面相似度。
 * **挑不到就返回 null**——宁可她这轮没经验可用，也别硬塞一条不相关的。
 *
 * @param {object[]} lessons
 * @param {{cue?: string}} [options]
 */
export function selectLesson(lessons, { cue = "" } = {}) {
  const text = String(cue ?? "").replace(/\s+/g, "");
  const ready = (Array.isArray(lessons) ? lessons : []).filter(
    (item) => item?.status === "active" && isLessonReady(item),
  );
  if (!ready.length) return null;

  let best = null;
  let bestScore = 0;
  for (const lesson of ready) {
    const hit = (lesson.when ?? []).some((word) => word && text.includes(word));
    const score = hit ? 1 : similarity(`${lesson.situation}${lesson.next}`, text);
    if (score < 0.34) continue;
    // 同分时先信置信度高的，再按 id 定序，保证同样输入永远挑同一条。
    const better =
      !best ||
      score > bestScore ||
      (score === bestScore &&
        (lesson.confidence > best.confidence ||
          (lesson.confidence === best.confidence && String(lesson.id) < String(best.id))));
    if (better) {
      best = lesson;
      bestScore = score;
    }
  }
  return best;
}

/** 字符二元组相似度（和 `core/beliefs.js` 同一把尺子）。 */
function similarity(a, b) {
  const left = String(a ?? "").replace(/\s+/g, "");
  const right = String(b ?? "").replace(/\s+/g, "");
  if (!left || !right) return 0;
  if (left === right) return 1;
  const grams = (text) => {
    const set = new Set();
    for (let i = 0; i + 1 < text.length; i++) set.add(text.slice(i, i + 2));
    if (text.length === 1) set.add(text);
    return set;
  };
  const A = grams(left);
  const B = grams(right);
  let hit = 0;
  for (const gram of A) if (B.has(gram)) hit += 1;
  return hit / Math.max(1, new Set([...A, ...B]).size);
}

/**
 * 渲染一条经验。
 *
 * 句式固定成「上回这种时候：…；我…，…。下回…。」——它读起来像回忆，不像结论，
 * 这样她才不会把它当成一条可以朗读的道理。
 */
export function renderLesson(lesson) {
  if (!lesson) return "";
  const head = `- 上回这种时候：${lesson.situation}；我${lesson.did}`;
  const tail = lesson.outcome ? `，${lesson.outcome}。` : "。";
  const next = lesson.next ? `下回${lesson.next}。` : "";
  const line = `${head}${tail}${next}`;
  return [...line].length > LESSON_LINE_MAX ? `${[...line].slice(0, LESSON_LINE_MAX - 1).join("")}…` : line;
}

/* ─────────────────────── 想事情的路子 ─────────────────────── */

/**
 * 一条想事情的路子。
 *
 * `because` 是它从哪几次行为里读出来的（至少 3 条证据）；`limit` 是**它什么时候不适用**——
 * 没有 limit 的路子会变成卡通人设，所以它是必填的。
 */
export function normalizeDisposition(raw, { now = 0 } = {}) {
  const text = clean(raw?.text, 44);
  const because = clean(raw?.because, 90);
  const limit = clean(raw?.limit, 60);
  const evidence = (Array.isArray(raw?.evidence) ? raw.evidence : [])
    .map((item) => clean(item, 48))
    .filter(Boolean)
    .slice(0, 8);
  const sources = (Array.isArray(raw?.sources) ? raw.sources : [])
    .map((item) => clean(item, 40))
    .filter(Boolean)
    .slice(0, 6);
  return {
    id: clean(raw?.id, 40) || `dp_${hash(text)}`,
    text,
    because,
    limit,
    evidence,
    sources,
    since: int(raw?.since, now) || now,
    status: DISPOSITION_STATUSES.includes(raw?.status) ? raw.status : "active",
    ownerApproved: raw?.ownerApproved === true,
    retiredReason: clean(raw?.retiredReason, 60),
    revokedAt: int(raw?.revokedAt, 0),
    revokedReason: clean(raw?.revokedReason, 60),
    revisions: Array.isArray(raw?.revisions) ? raw.revisions.slice(0, 5) : [],
  };
}

/** 这条路子还差什么。证据要 3 条：一次是偶然，三次才是路子。 */
export function dispositionIssues(disposition) {
  const issues = [];
  if (!disposition?.text) issues.push("no_text");
  if ([...(disposition?.text ?? "")].length > 44) issues.push("too_long");
  if (!disposition?.because) issues.push("no_because");
  if (!disposition?.limit) issues.push("no_limit");
  if ((disposition?.evidence?.length ?? 0) < 3) issues.push("no_evidence");
  if (!disposition?.ownerApproved && isPlatitude(disposition?.text)) issues.push("platitude");
  return issues;
}

export const isDispositionReady = (disposition) => dispositionIssues(disposition).length === 0;

/**
 * 渲染想事情的路子。
 *
 * 头部那句「不是台词」是出口纪律的一部分：**一般不说出口，除非他主动问**。
 * 光靠内容克制不住模型，得在它旁边写清楚这是背景，不是可念的句子。
 */
export function renderDispositions(dispositions) {
  const ready = (Array.isArray(dispositions) ? dispositions : [])
    .filter((item) => item?.status === "active" && isDispositionReady(item))
    .sort((a, b) => a.since - b.since || (String(a.id) < String(b.id) ? -1 : 1))
    .slice(0, DISPOSITION_ITEMS);
  if (!ready.length) return "";
  const body = [...`${ready.map((item) => item.text).join("；")}。`].slice(0, DISPOSITION_BODY_MAX).join("");
  return `你平时想事情的路子（不是台词，不问就不提，他真问起才认）：\n${body}`;
}

/* ─────────────────────── 合成一块 ─────────────────────── */

/**
 * 这一轮的结晶块。空串表示这一轮没有可用的结晶——块不占位。
 *
 * @param {{lessons?: object[], dispositions?: object[]}} data
 * @param {{cue?: string}} [options]
 */
export function crystalBlock(data, { cue = "" } = {}) {
  const parts = [];
  const lesson = selectLesson(data?.lessons, { cue });
  if (lesson) {
    parts.push(`你自己试出来的一件事（别讲成道理，碰到就照做）：\n${renderLesson(lesson)}`);
  }
  const think = renderDispositions(data?.dispositions);
  if (think) parts.push(think);
  return parts.join("\n");
}

/* ─────────────────────── 生长与修订（给 owner 的脚本用） ─────────────────────── */

/**
 * 这条经验又被验证了一次：命中数 +1，置信度小幅上调（上限 0.9）。
 * 只上调不封顶会变成「我永远对」，所以封在 0.9。
 */
export function promoteLesson(lesson, { evidence = [], now = 0 } = {}) {
  const merged = new Set([...(lesson?.evidence ?? []), ...(Array.isArray(evidence) ? evidence : [])]);
  return {
    ...lesson,
    evidence: [...merged].slice(0, 6),
    hits: (lesson?.hits ?? 0) + 1,
    lastHit: now,
    confidence: clamp((lesson?.confidence ?? 0.5) + 0.05, 0.2, 0.9),
  };
}

/**
 * 改一条经验。旧版本进 `history`（≤5），`createdAt` 不动——
 * 这样她自己能说出「我以前以为是……后来发现不是」，也有据可查。
 */
export function reviseLesson(lesson, patch = {}, { now = 0 } = {}) {
  const before = {
    situation: lesson?.situation,
    did: lesson?.did,
    outcome: lesson?.outcome,
    next: lesson?.next,
    counter: lesson?.counter,
    result: lesson?.result,
    at: now,
  };
  const merged = normalizeLesson({ ...lesson, ...patch, createdAt: lesson?.createdAt ?? now }, { now, source: lesson?.source });
  return {
    ...merged,
    id: lesson?.id ?? merged.id,
    history: [before, ...(lesson?.history ?? [])].slice(0, 5),
  };
}

/** 淘汰：不删，标 retired 留账。 */
export const retireLesson = (lesson, reason = "") => ({
  ...lesson,
  status: "retired",
  retiredReason: clean(reason, 40),
});

/** 改一条想事情的路子：旧版本进 `revisions`，`since` 不动。 */
export function reviseDisposition(disposition, patch = {}, { now = 0 } = {}) {
  const before = {
    text: disposition?.text,
    because: disposition?.because,
    limit: disposition?.limit,
    at: now,
  };
  const merged = normalizeDisposition({ ...disposition, ...patch, since: disposition?.since ?? now }, { now });
  return {
    ...merged,
    id: disposition?.id ?? merged.id,
    revisions: [before, ...(disposition?.revisions ?? [])].slice(0, 5),
  };
}

/** 退役 / 撤销：都不删，留一个状态和一句为什么。 */
export const retireDisposition = (disposition, reason = "") => ({
  ...disposition,
  status: "retired",
  retiredReason: clean(reason, 60),
});

export const revokeDisposition = (disposition, reason = "", { now = 0 } = {}) => ({
  ...disposition,
  status: "revoked",
  revokedAt: now,
  revokedReason: clean(reason, 60),
});

/* ─────────────────────── 上限与种子 ─────────────────────── */

/** 超过 20 条时先留 active、再留置信度高的、再留新的。 */
export function capLessons(lessons) {
  const rank = (item) => (item?.status === "active" ? 0 : 1);
  return [...(Array.isArray(lessons) ? lessons : [])]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (b?.confidence ?? 0) - (a?.confidence ?? 0) ||
        (b?.createdAt ?? 0) - (a?.createdAt ?? 0) ||
        (String(a?.id) < String(b?.id) ? -1 : 1),
    )
    .slice(0, MAX_LESSONS);
}

/** 超过 8 条时先留 active，再留更早的（越早越稳）。 */
export function capDispositions(dispositions) {
  const rank = (item) => (item?.status === "active" ? 0 : 1);
  return [...(Array.isArray(dispositions) ? dispositions : [])]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a?.since ?? 0) - (b?.since ?? 0) ||
        (String(a?.id) < String(b?.id) ? -1 : 1),
    )
    .slice(0, MAX_DISPOSITIONS);
}

/**
 * 人格档案里的种子。它们和 `beliefs` 的种子一样：只在读的时候合并，
 * 不写进数据目录；同 id 的文件条目会盖过种子。
 *
 * 种子也过闸门。过不了的不删——`serene_state` 里能看到它缺什么，
 * 但 `selectLesson()` / `renderDispositions()` 不会用它。
 */
export function normalizeCrystals(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const lessons = capLessons(
    (Array.isArray(source.lessons) ? source.lessons : []).map((item) =>
      normalizeLesson(item, { source: item?.source ?? "persona" }),
    ),
  );
  const dispositions = capDispositions(
    (Array.isArray(source.dispositions) ? source.dispositions : []).map((item) => normalizeDisposition(item)),
  );
  return { lessons, dispositions };
}
