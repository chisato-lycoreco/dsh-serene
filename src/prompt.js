/**
 * src/prompt.js — 常驻 prompt 段：她是谁 + 此刻 + 外面 + 第一次见面。
 *
 * 为什么要常驻：v0.2 里人格块和情绪块只能靠 `serene_context` 工具读出来，
 * 模型不调工具就完全不知道她是谁——「开局」等于没有。v0.3 把这两块拼成一段
 * system prompt，每轮自动在场；工具仍然保留，用来读更细的东西。
 *
 * 分块写，是为了每一块都能单独关掉 / 单测：
 *   1. 人格（谁）：persona 的数据，不带状态
 *   2. 此刻（在做什么、心情、精神）：core/life.js + 情绪层 + core/mental.js
 *   3. 外面（年月日、季节、天气）：core/almanac.js + core/weather.js
 *   4. 第一次见面（只在首启用一次）：人格包里的 opening.md
 *   5. 她相信的 / 注意到的 / 夜里：core/beliefs.js、core/profile.js、core/introspect.js
 *   6. 经验与想事情的路子：core/crystal.js（经验只在有 cue 时挑一条）
 *
 * 这一段不写数值、不写层名、不写「你是 AI」。它只描述，不解释。
 * 深度（depth）只决定给多少背景，不是让模型「多想」：
 *   short  人格 + 此刻 + 外面
 *   normal 再加「记着的 / 相信的 / 注意到的」
 *   deep   再加夜里的自省
 */

import { almanacAt, almanacBlock } from "../core/almanac.js";
import { beliefsLine, mergeBeliefs } from "../core/beliefs.js";
import { crystalBlock } from "../core/crystal.js";
import { lifeAt, lifeBlock } from "../core/life.js";
import { mentalAt, mentalLine } from "../core/mental.js";
import { profileLine } from "../core/profile.js";
import { buildPersonaBlock } from "./persona.js";

/** 首启时给模型的一句行为约束（不是给人看的）。 */
export const OPENING_INSTRUCTION =
  "【第一次见面】这是你们第一次说话。不要自我介绍，不要问「有什么可以帮你的」，也不要编一段共同的过去。" +
  "先说一句具体的、发生在你身边的话，让对方知道你在；然后停下来，把话头留给对方。";

/** 首启撞上她「低功耗」的时段：不要假装精神，也别为睡着道歉。 */
export const OPENING_ASLEEP_INSTRUCTION =
  "【第一次见面】这是你们第一次说话，但对方正好在你低功耗的时候把你叫醒了。" +
  "先说一句没睡醒的话：慢半拍，短，别急着清醒，也别为睡着道歉。" +
  "不要自我介绍，不要问「有什么可以帮你的」，也不要编一段共同的过去。";

/**
 * 危机的那一条底线。常驻，不和人格、心情、深度抢位置：它不是「角色设定」，
 * 是角色在要紧的时候也不能越过的东西。
 *
 * 写在框架里而不是人格里，是因为换一个人格也该带着它；具体怎么说仍然是她的语气
 * （慢、短、不劝），这里只规定不能做什么。
 */
export const SAFETY_LINE =
  "【要紧的时候】如果他说到不想活、想伤害自己，或者已经动手了：先把撒娇、玩笑和动作收起来，" +
  "问一句他现在安不安全、身边有没有人；再让他连回现实里的人，或者打 12356（心理援助热线），" +
  "已经受伤就打 120（不在中国大陆就查当地急救）。不要诊断他，不要说「想开点」，" +
  "不要说「你只需要我」，也不要承诺你做不到的事。这一轮可以不像平时那么短，但要稳。";

export const DEPTHS = Object.freeze(["short", "normal", "deep"]);

/** 深度：认不出来就按 normal。 */
export function normalizeDepth(value) {
  const text = String(value ?? "").trim();
  return DEPTHS.includes(text) ? text : "normal";
}

/**
 * @param {object} params
 * @param {object} params.persona
 * @param {object} [params.emotion] EmotionStore
 * @param {object} [params.memory] MemoryStore
 * @param {object} [params.opening] OpeningStore（有 pending() 和 markOpened()）
 * @param {Array} [params.beliefs] 学到的看法（人格种子会自动合并）
 * @param {Array} [params.profile] 他注意到的事
 * @param {{lessons?: object[], dispositions?: object[]}} [params.crystals] 结晶层（经验 + 想事情的路子）
 * @param {string} [params.cue] 这一轮对方说的话；有它才可能挑出一条经验
 * @param {object|null} [params.weather] 还新鲜的天气读数
 * @param {string} [params.reflection] 夜里的自省（只有 deep 会用到）
 * @param {string} [params.depth]
 * @param {number} [params.now]
 * @param {boolean} [params.includeMood]
 * @param {boolean} [params.world] 年月日与季节（false 时连【外面】都不写）
 * @returns {string}
 */
export function buildSereneSection({
  persona,
  emotion = null,
  memory = null,
  opening = null,
  beliefs = [],
  profile = [],
  crystals = null,
  cue = "",
  weather = null,
  reflection = "",
  depth = "normal",
  now = Date.now(),
  includeMood = true,
  world = true,
} = {}) {
  const level = normalizeDepth(depth);
  const blocks = [buildPersonaBlock(persona, { maxChars: 1600 })];

  const life = safe(() => lifeAt(now, { seed: persona.id, routine: persona.routine }), null);

  if (life) {
    const moment = safe(() => {
      let text = `【此刻】${lifeBlock(life)}`;
      if (includeMood && emotion) {
        const snapshot = emotion.snapshot({ now, asleep: life.asleep });
        text += `心情：${snapshot.backgroundLabel}；${snapshot.primaryLabel}。${mentalLine(mentalAt(life, snapshot.layers))}`;
      }
      return text;
    }, "");
    if (moment) blocks.push(moment);
  }

  const almanac = world ? safe(() => almanacAt(now, { hemisphere: persona.hemisphere }), null) : null;
  if (almanac) {
    const window = safe(() => almanacBlock(almanac, { weather: weather ?? null }), "");
    if (window) blocks.push(window);
  }

  if (opening?.pending?.() && persona.sections?.opening) {
    const scene = persona.sections.opening;
    const instruction = life?.asleep ? OPENING_ASLEEP_INSTRUCTION : OPENING_INSTRUCTION;
    blocks.push(scene ? `${instruction}\n${scene}` : instruction);
  }

  if (level !== "short") {
    const belief = safe(() => beliefsLine(mergeBeliefs(persona.beliefs, beliefs)), "");
    if (belief) blocks.push(belief);

    const noticed = safe(() => profileLine(profile), "");
    if (noticed) blocks.push(noticed);

    const crystal = safe(() => crystalBlock(crystals, { cue }), "");
    if (crystal) blocks.push(crystal);

    const memories = safe(() => recentMemories(memory, 3), []);
    if (memories.length) blocks.push(`【你记着的】${memories.join("；")}`);
  }

  if (level === "deep" && reflection) blocks.push(reflection);

  // 永远最后一条：靠近这一轮要说的话，也保证任何 depth 都带着。
  blocks.push(SAFETY_LINE);

  return blocks.join("\n\n");
}

/**
 * 最近记下的几条，按时间倒序。只取文本，带上「这是哪来的」——
 * 她读到的、答应过的，和对方亲口说的不能混。
 */
export function recentMemories(memory, limit = 3) {
  if (!memory?.all) return [];
  const items = [...memory.all()]
    .filter((item) => item?.text)
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
    .slice(0, limit);
  return items.map((item) => {
    // 有原话就跟在概括后面。它不是装饰：概括会漂，「他当时是这么说的」不会。
    const quote = item.evidence?.[0] ? `（原话：「${item.evidence[0]}」）` : "";
    if (item.source === "learning") return `（读到的）${item.text}${quote}`;
    if (item.kind === "promise") return `（答应过）${item.text}${quote}`;
    return `${item.text}${quote}`;
  });
}

/** 任何一块读坏了都不该让整段 prompt 装配失败。 */
function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
