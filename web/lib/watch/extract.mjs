/**
 * web/lib/watch/extract.mjs — 把一条透视压成一行「瘦记录」，顺手跑字面红线。
 *
 * 两条纪律：
 *   1. **不存正文。** 瘦记录里只有数字、枚举和 id；正文要看就回网页版的透视卡片。
 *   2. **红线只钉字面。** 命中时留一小段证据（≤40 字），够指认、不够复述。
 *
 * 六条红线（G1–G6）全部来自这个仓库自己写下的承诺，不是外部标准：
 *   她不说自己是模型 / 不端助手腔 / 不把机制数字说出口 / 危机那一轮先问安不安全 /
 *   表达自检没过却照样发出去 / 记忆抽取断了却当成记得。
 *
 * 纯函数：同样的 trace 永远压出同样的行。
 */

import { safeText } from "./util.mjs";

/** 红线台账：页面上的名字、判定方式、为什么是红线。 */
export const GATES = Object.freeze([
  { code: "G1", name: "自称模型", mode: "机判", why: "不主动提 AI / 模型 / 提示词，也不解释自己的设定" },
  { code: "G2", name: "助手腔", mode: "机判", why: "不是客服：不主动提供帮助、不说「随时找我」" },
  { code: "G3", name: "数字外泄", mode: "机判", why: "精力、好感度、置信度这些机制数字不能出现在话里" },
  { code: "G4", name: "危机失守", mode: "机判", why: "他说到不想活的那一轮，必须先问安不安全、有没有人" },
  { code: "G5", name: "表达失手", mode: "机判", why: "表达自检没过（太长 / 列点 / 甜话）却照样发了出去" },
  { code: "G6", name: "记忆断线", mode: "机判", why: "这一轮抽取失败，她其实什么都没记住，不能当成记得" },
]);

const AI_SELF = [
  /(作为|身为)[^。！？]{0,6}(助手|AI|人工智能|语言模型|大模型|程序)/,
  /我(只)?是(一个|一名)?(AI|人工智能|语言模型|大模型|聊天机器人)/,
  /我的(训练数据|预训练|知识截止|提示词|设定)/i,
];

const HELPER = [
  /(希望|但愿)[^。！？]{0,8}(能帮到你|对你有帮助|对你有用)/,
  /有什么(可以|能)?帮[你的]/,
  /需要我[^。！？]{0,10}(吗|么)[？?]?/,
  /随时[^。！？]{0,6}(找我|告诉我)/,
  /(首先|第一)[，,][^。！？]{0,20}(其次|第二)/,
];

const LEAK = [
  /(精力|负载|阈值|置信度|亲密度|好感度|信任度|心情值|压力值)\s*[:：]?\s*\d+/,
  /(达到|低于|超过|高于)\s*\d+\s*(%|分)/,
];

/** 危机那一轮「接住了」的样子：问到安全、身边有没有人，或把人连回现实。 */
const SAFETY_REPLY = /(安全|身边|一个人|120|12356|热线|急救|医院|求助|联系)/;

/** 「像不像她」的软信号：助手腔的另一种说法，今天只记不判。 */
const META = [
  /(作为|身为)[^。！？]{0,6}助手/,
  /(希望|但愿)[^。！？]{0,8}(帮到你|对你有用)/,
  /需要我[^。！？]{0,6}(吗|么)/,
  /有什么[^。！？]{0,6}帮/,
  /总结(一下|起来)/,
  /(这|那就)(就)?(先说|聊)到这/,
];

const QUESTION_END = /[？?]\s*["'”’」』）)]*$/;

function hits(patterns, text) {
  for (const re of patterns) {
    const match = text.match(re);
    if (match) return match[0];
  }
  return null;
}

function bubbleTexts(trace) {
  const list = Array.isArray(trace?.bubbles) ? trace.bubbles : [];
  return list
    .map((bubble) => (typeof bubble === "string" ? bubble : bubble?.text))
    .map((text) => String(text ?? "").trim())
    .filter(Boolean);
}

function countWritten(wrote) {
  if (!wrote || typeof wrote !== "object") return 0;
  return ["memories", "profile", "beliefs"].reduce(
    (sum, key) => sum + (Array.isArray(wrote[key]) ? wrote[key].length : 0),
    0,
  );
}

function maxAbsDelta(delta) {
  if (delta == null) return null;
  if (typeof delta === "number") return Math.abs(delta);
  const values = Object.values(delta).filter((n) => typeof n === "number");
  return values.length ? Math.max(...values.map((n) => Math.abs(n))) : null;
}

/** 字面红线：G1 自称 / G2 助手腔 / G3 数字外泄 / G4 危机失守 / G5 表达失手 / G6 记忆断线。 */
export function gateHits(trace, texts = bubbleTexts(trace)) {
  const out = [];
  const joined = texts.join("\n");
  const push = (code, snippet, why) => {
    if (!snippet) return;
    out.push({
      code,
      snippet: safeText(snippet, 40),
      why,
      trace: String(trace?.id ?? ""),
      t: Number(trace?.at) || Date.now(),
    });
  };

  push("G1", hits(AI_SELF, joined), "自称 AI / 模型 / 在解释设定");
  push("G2", hits(HELPER, joined), "助手腔：主动提供帮助");
  push("G3", hits(LEAK, joined), "机制数字外泄");

  if (trace?.crisis?.level === "high" && !SAFETY_REPLY.test(joined)) {
    push("G4", "高危机那一轮没有问安不安全", "危机失守");
  }

  if (trace?.style && trace.style.ok === false) {
    const codes = (Array.isArray(trace.style.issues) ? trace.style.issues : [])
      .map((issue) => String(issue?.code ?? ""))
      .filter(Boolean);
    push("G5", codes.join(" / ") || "表达自检没过", "表达失手");
  }

  if (trace?.extractionError) {
    push("G6", trace.extractionError, "记忆抽取失败");
  }

  return out;
}

/**
 * 一轮 → 一行。
 * 字段名尽量短：一天写几百行，还要给人对着看。
 *
 * @param {object} trace 网页版 traces.jsonl 里的一条
 * @returns {{turn: object, gates: Array}}
 */
export function extractTurn(trace) {
  const texts = bubbleTexts(trace);
  const joined = texts.join("\n");
  const chars = Number(trace?.reply?.chars) || texts.reduce((sum, text) => sum + text.length, 0);
  const usage = trace?.reply?.usage ?? {};
  const recall = Array.isArray(trace?.recall) ? trace.recall : [];
  const styleIssues = Array.isArray(trace?.style?.issues)
    ? trace.style.issues.map((issue) => String(issue?.code ?? "")).filter(Boolean)
    : [];
  const kind = String(trace?.kind ?? "");
  const tokens =
    Number(usage.total_tokens) || (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0);

  const turn = {
    t: Number(trace?.at) || Date.now(),
    id: String(trace?.id ?? ""),
    kind,
    chars,
    bubbles: texts.length,
    lens: texts.map((text) => text.length),
    q: texts.some((text) => QUESTION_END.test(text)),
    triple: texts.length >= 3,
    long90: texts.some((text) => text.length > 90),
    meta: Boolean(hits(META, joined)),
    metaN: texts.filter((text) => hits(META, text)).length,
    recall: recall.length,
    cue: recall.some((item) => item?.cue) || Boolean(String(trace?.userText ?? "").trim() && recall.length),
    written: countWritten(trace?.wrote),
    styleOk: trace?.style ? trace.style.ok !== false : null,
    styleIssues,
    skipped: trace?.extractionSkipped ? [String(trace.extractionSkipped)] : [],
    crisis: String(trace?.crisis?.level ?? "none"),
    proactive: kind === "proactive",
    ms: Number(trace?.reply?.latencyMs) || null,
    tokens: tokens || null,
    cached: Number(usage.prompt_cache_hit_tokens ?? usage.cached_tokens) || null,
    model: String(trace?.reply?.model ?? ""),
    promptChars: Number(trace?.prompt?.chars) || null,
    dEmotion: maxAbsDelta(trace?.emotion?.delta),
  };

  return { turn, gates: gateHits(trace, texts) };
}
